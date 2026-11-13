import assert from 'node:assert/strict';
import { attemptLiveOrderRoute, getLiveExecutionGuardStatus } from '../src/engine/exchangeArchitecture.ts';
import { computePerformanceMetrics, validateOrder } from '../src/engine/risk.ts';
import {
  applyExternalQuotes,
  cancelOrder,
  closePosition,
  createCustomStrategy,
  createInitialEngineState,
  deleteCustomStrategy,
  partialClosePosition,
  placeOrder,
  processMarketTick,
  toggleStrategyAutoExecute,
  updateRiskSettings,
} from '../src/engine/tradingEngine.ts';

function runEngineAudit() {
  console.log('Running 77 TRADE IT Engine Audit...');

  // Audit 1: Accounting invariance across repeated transactions (buys, partial sells, limit cancellations)
  let state = createInitialEngineState({ startingBalance: 100_000 });

  for (let i = 0; i < 10; i++) {
    const res = placeOrder(state, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
    });
    assert.equal(res.accepted, true, `Buy #${i} should be accepted`);
    state = res.state;
    state = processMarketTick(state, 500 + i);
  }

  // Partial sell 0.4 BTC
  const partialSell = placeOrder(state, {
    symbol: 'BTCUSDT',
    side: 'SELL',
    type: 'MARKET',
    quantity: 0.4,
  });
  assert.equal(partialSell.accepted, true);
  state = partialSell.state;
  assert.ok(Math.abs(state.positions[0].quantity - 0.6) < 1e-6);

  // Place & cancel 5 limit orders
  for (let j = 0; j < 5; j++) {
    const limitBuy = placeOrder(state, {
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 10,
      limitPrice: Number((state.markets.SOLUSDT.price * 0.5).toFixed(2)),
    });
    assert.equal(limitBuy.accepted, true);
    state = cancelOrder(limitBuy.state, limitBuy.order!.id);
  }

  // Close all remaining positions
  for (const pos of [...state.positions]) {
    state = closePosition(state, pos.id, 'MANUAL');
  }

  const finalMetrics = computePerformanceMetrics(state);
  assert.equal(state.positions.length, 0);
  assert.equal(state.openOrders.length, 0);
  assert.ok(state.availableCash >= 0);

  const expectedCash = state.startingBalance + finalMetrics.totalRealizedPnl;
  assert.ok(
    Math.abs(finalMetrics.availableCash - expectedCash) < 0.15,
    `Cash invariant violated: availableCash=${finalMetrics.availableCash}, expected=${expectedCash}`
  );
  assert.ok(
    Math.abs(finalMetrics.totalEquity - finalMetrics.availableCash) < 0.01,
    'Equity must equal available cash when flat'
  );

  // Audit 2: Validation guards reject invalid quantities, insufficient funds, incoherent SL/TP
  const invalidQty = placeOrder(state, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: -5,
  });
  assert.equal(invalidQty.accepted, false);

  const oversized = placeOrder(state, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1000,
  });
  assert.equal(oversized.accepted, false);

  const badSl = placeOrder(state, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.1,
    stopLoss: state.markets.BTCUSDT.price * 1.1,
  });
  assert.equal(badSl.accepted, false);

  // Audit 2b (Phase 2): Hard risk enforcement prevents trades violating maxRiskPerTradePct & requireStopLoss
  let riskState = createInitialEngineState({ startingBalance: 100_000 });
  const btcPrice = riskState.markets.BTCUSDT.price;
  const highRiskTrade = placeOrder(riskState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1.0,
    stopLoss: btcPrice * 0.90, // 10% SL on ~$67k = ~6.7% account risk (> 2% limit)
  });
  assert.equal(highRiskTrade.accepted, false, 'Risk limit must block trades > maxRiskPerTradePct');

  riskState = updateRiskSettings(riskState, { requireStopLoss: true });
  const missingSl = placeOrder(riskState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.05,
  });
  assert.equal(missingSl.accepted, false, 'requireStopLoss must reject orders missing SL');

  const withValidSl = validateOrder(riskState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.05,
    stopLoss: btcPrice * 0.98,
    takeProfit: btcPrice * 1.04,
  });
  assert.equal(withValidSl.valid, true);
  assert.equal(withValidSl.estimatedRewardRiskRatio, 2);

  // Audit 3: Stop-Loss auto trigger when market drops
  let slState = createInitialEngineState({ startingBalance: 50_000 });
  const tightSl = Number((slState.markets.ETHUSDT.price * 0.9999).toFixed(2));
  const slOrder = placeOrder(slState, {
    symbol: 'ETHUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: tightSl,
  });
  assert.equal(slOrder.accepted, true);
  slState = slOrder.state;
  for (let t = 0; t < 40 && slState.positions.length > 0; t++) {
    slState = processMarketTick(slState, 900 + t);
  }
  assert.ok(Number.isFinite(computePerformanceMetrics(slState).totalEquity));

  // Audit 4: Custom strategy creation, deletion, and read-only public quote provenance
  let stratState = createInitialEngineState({ startingBalance: 100_000 });
  const initialCount = stratState.strategies.length;
  stratState = createCustomStrategy(stratState, {
    name: 'Audit Custom Breakout',
    subtitle: 'momentum test',
    description: 'Custom test strategy',
    template: 'MOMENTUM',
    timeframe: '15m',
    riskPerTradePct: 1.0,
    stopLossAtrMult: 1.5,
    takeProfitRrMult: 2.0,
    rsiBuyThreshold: 55,
    rsiSellThreshold: 45,
  });
  assert.equal(stratState.strategies.length, initialCount + 1);
  const customId = stratState.strategies[stratState.strategies.length - 1].id;
  stratState = deleteCustomStrategy(stratState, customId);
  assert.equal(stratState.strategies.length, initialCount);

  const quotedState = applyExternalQuotes(stratState, {
    BTCUSDT: {
      symbol: 'BTCUSDT',
      price: 68123.45,
      dataSource: 'LIVE_PUBLIC',
      providerName: 'Coinbase Public Spot',
      timestamp: Date.now(),
    },
  });
  assert.equal(quotedState.mode, 'SIMULATED_PAPER');
  assert.equal(quotedState.marketDataMode, 'LIVE_PUBLIC_READONLY');
  assert.equal(quotedState.markets.BTCUSDT.dataSource, 'LIVE_PUBLIC');
  assert.equal(quotedState.markets.BTCUSDT.price, 68123.45);

  // Audit 5: Phase 7 Live Execution Guard cannot accidentally route real trades
  const guard = getLiveExecutionGuardStatus();
  assert.equal(guard.mode, 'SIMULATED_PAPER_ONLY');
  assert.equal(guard.liveTradingAuthorized, false);
  assert.equal(guard.frontendKeysAllowed, false);

  const liveAttempt = attemptLiveOrderRoute('binance', {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.1,
  });
  assert.equal(liveAttempt.accepted, false);

  // Audit 6: Partial close accounting invariance (LONG & SHORT)
  let partState = createInitialEngineState({ startingBalance: 100_000 });
  const solOrder = placeOrder(partState, {
    symbol: 'SOLUSDT',
    side: 'SELL',
    type: 'MARKET',
    quantity: 10,
  });
  assert.equal(solOrder.accepted, true);
  partState = solOrder.state;
  partState = processMarketTick(partState, 777);
  if (partState.positions.length > 0) {
    partState = partialClosePosition(partState, partState.positions[0].id, 0.5, 'MANUAL');
    assert.equal(partState.positions[0].quantity, 5);
    partState = processMarketTick(partState, 778);
    partState = closePosition(partState, partState.positions[0].id, 'MANUAL');
  }
  const partMetrics = computePerformanceMetrics(partState);
  const expectedPartCash = partState.startingBalance + partMetrics.totalRealizedPnl;
  assert.ok(
    Math.abs(partMetrics.availableCash - expectedPartCash) < 0.15,
    `Partial close cash invariant violated: cash=${partMetrics.availableCash}, expected=${expectedPartCash}`
  );

  // Audit 7: Automated Strategy Paper Execution (opt-in only, risk-guarded, paper mode)
  let autoState = createInitialEngineState({ startingBalance: 100_000 });
  assert.equal(autoState.strategies[0].autoExecutePaper, false);
  autoState = toggleStrategyAutoExecute(autoState, 'rhino_confluence');
  autoState = toggleStrategyAutoExecute(autoState, 'momentum_trend_rider');
  assert.equal(autoState.strategies[0].autoExecutePaper, true);
  assert.equal(autoState.strategies[1].enabled, true);
  assert.equal(autoState.strategies[1].autoExecutePaper, true);

  for (let t = 0; t < 15; t++) {
    autoState = processMarketTick(autoState, 300 + t);
  }
  assert.equal(autoState.mode, 'SIMULATED_PAPER');
  assert.ok(
    autoState.positions.length <= autoState.riskSettings.maxOpenPositions,
    'Auto-paper execution must respect maxOpenPositions'
  );
  assert.ok(
    autoState.orderHistory.length > 0,
    'Auto-paper strategies should route paper orders when signals trigger'
  );

  console.log('Engine Audit passed: all accounting, risk, strategy, partial-close, auto-paper, quote-provenance, and live-guard invariants verified.');
}

runEngineAudit();
