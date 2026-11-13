import assert from 'node:assert/strict';
import { computeAllIndicators, computeEMA, computeRSI, computeSMA } from '../src/engine/indicators.ts';
import { createInitialMarketsAndCandles } from '../src/engine/marketData.ts';
import { runBacktest } from '../src/engine/strategies.ts';
import {
  applyExternalQuotes,
  applyHistoricalCandles,
  cancelOrder,
  closePosition,
  createInitialEngineState,
  partialClosePosition,
  placeOrder,
  processMarketTick,
  updatePositionTargets,
  updateRiskSettings,
} from '../src/engine/tradingEngine.ts';
import {
  computePerformanceMetrics,
  calculateSuggestedPositionSize,
  computeStrategyAttribution,
  deriveAccountTransactions,
} from '../src/engine/risk.ts';
import { buildSimulatedOrderBook } from '../src/engine/orderBook.ts';

function runUnitTests() {
  console.log('Running 77 TRADE IT Unit Tests...');

  // 1. Indicators mathematical checks
  const sma = computeSMA([10, 20, 30, 40, 50], 3);
  assert.equal(sma[0], null);
  assert.equal(sma[1], null);
  assert.equal(sma[2], 20);
  assert.equal(sma[3], 30);
  assert.equal(sma[4], 40);

  const ema = computeEMA([10, 12, 14, 16, 18], 3);
  assert.equal(ema[2], 12);
  assert.ok(ema[4] !== null && ema[4] > 14);

  const uptrend = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const rsi = computeRSI(uptrend, 14);
  assert.equal(rsi[29], 100);

  // 2. Market data & full indicator suite
  const { markets, candles } = createInitialMarketsAndCandles();
  assert.ok(markets.BTCUSDT.price > 0);
  assert.equal(markets.BTCUSDT.dataSource, 'SIMULATED');
  assert.equal(candles.BTCUSDT['1h'].length, 120);

  const ind = computeAllIndicators(candles.BTCUSDT['1h']);
  assert.equal(ind.ema20.length, 120);
  assert.equal(ind.macdHistogram.length, 120);
  assert.equal(ind.bbUpper.length, 120);

  // 3. Paper order execution: Market BUY -> Market Tick -> Manual Close
  let state = createInitialEngineState({ startingBalance: 100_000 });
  const btcPrice = state.markets.BTCUSDT.price;
  const buyRes = placeOrder(state, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.5,
    stopLoss: btcPrice * 0.96,
    takeProfit: btcPrice * 1.08,
  });
  assert.equal(buyRes.accepted, true);
  state = buyRes.state;
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].quantity, 0.5);

  const expectedFee = 0.5 * btcPrice * state.riskSettings.feeRate;
  const afterBuyMetrics = computePerformanceMetrics(state);
  assert.ok(Math.abs(afterBuyMetrics.totalEquity - (100_000 - expectedFee)) < 0.05);

  // Advance market 3 ticks and close
  state = processMarketTick(state, 101);
  state = processMarketTick(state, 102);
  state = closePosition(state, state.positions[0].id, 'MANUAL');
  assert.equal(state.positions.length, 0);
  assert.equal(state.closedTrades.length, 1);

  // 4. Limit order cash reservation and cancellation refund
  const cashBeforeLimit = state.availableCash;
  const lowLimitPrice = Number((state.markets.ETHUSDT.price * 0.75).toFixed(2));
  const limitRes = placeOrder(state, {
    symbol: 'ETHUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 2,
    limitPrice: lowLimitPrice,
  });
  assert.equal(limitRes.accepted, true);
  state = limitRes.state;
  assert.equal(state.openOrders.length, 1);
  assert.ok(state.availableCash < cashBeforeLimit);

  state = cancelOrder(state, state.openOrders[0].id);
  assert.equal(state.openOrders.length, 0);
  assert.ok(Math.abs(state.availableCash - cashBeforeLimit) < 0.01);

  // 5. Position sizing & backtest execution
  const sized = calculateSuggestedPositionSize({
    equity: 100_000,
    riskPct: 1.5,
    entryPrice: 60_000,
    stopLossPrice: 58_500,
    minQty: 0.0001,
  });
  assert.equal(sized, 1);

  const bt = runBacktest(
    state.strategies[0],
    'BTCUSDT',
    '1h',
    state.candles.BTCUSDT['1h'],
    100_000,
    0.001
  );
  assert.equal(bt.barsTested, 122);
  assert.ok(bt.equityCurve.length === 122);
  assert.ok(Number.isFinite(bt.finalEquity));

  // 6. Phase 2: Volume SMA, Extended Analytics, and Custom Strategy Lifecycle
  assert.equal(ind.volumeSma20.length, 120);
  assert.ok(ind.volumeSma20[119] !== null && ind.volumeSma20[119]! > 0);

  const metricsAfterClose = computePerformanceMetrics(state);
  assert.ok(Number.isFinite(metricsAfterClose.totalProfit));
  assert.ok(Number.isFinite(metricsAfterClose.totalLosses));
  assert.ok(Number.isFinite(metricsAfterClose.bestTrade));
  assert.ok(Number.isFinite(metricsAfterClose.worstTrade));

  // 7. Position SL/TP target updates, partial close (50%), and strategy attribution
  let posState = createInitialEngineState({ startingBalance: 100_000 });
  const ethPrice = posState.markets.ETHUSDT.price;
  const openEth = placeOrder(posState, {
    symbol: 'ETHUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 2,
    stopLoss: Number((ethPrice * 0.96).toFixed(2)),
    takeProfit: Number((ethPrice * 1.08).toFixed(2)),
    strategyId: 'rhino_confluence',
  });
  assert.equal(openEth.accepted, true);
  posState = openEth.state;
  const posId = posState.positions[0].id;

  // Reject invalid SL above current market price for LONG
  const badTarget = updatePositionTargets(
    posState,
    posId,
    Number((ethPrice * 1.05).toFixed(2)),
    Number((ethPrice * 1.1).toFixed(2))
  );
  assert.equal(badTarget.accepted, false);

  // Accept valid SL/TP update
  const goodTarget = updatePositionTargets(
    posState,
    posId,
    Number((ethPrice * 0.97).toFixed(2)),
    Number((ethPrice * 1.1).toFixed(2))
  );
  assert.equal(goodTarget.accepted, true);
  posState = goodTarget.state;
  assert.equal(posState.positions[0].stopLoss, Number((ethPrice * 0.97).toFixed(2)));

  // Partial close 50% -> remaining qty = 1, closedTrades = 1
  posState = partialClosePosition(posState, posId, 0.5, 'MANUAL');
  assert.equal(posState.positions.length, 1);
  assert.equal(posState.positions[0].quantity, 1);
  assert.equal(posState.closedTrades.length, 1);

  const attribution = computeStrategyAttribution(posState);
  const rhinoAttr = attribution.find((a) => a.strategyId === 'rhino_confluence');
  assert.ok(rhinoAttr);
  assert.equal(rhinoAttr.openPositionsCount, 1);
  assert.equal(rhinoAttr.closedTradesCount, 1);

  // 8. Simulated Order Book ladder, spread, and user resting order merge
  let bookState = createInitialEngineState({ startingBalance: 100_000 });
  const restingBidPrice = Number((bookState.markets.BTCUSDT.price * 0.9).toFixed(2));
  const restingOrder = placeOrder(bookState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 0.25,
    limitPrice: restingBidPrice,
  });
  assert.equal(restingOrder.accepted, true);
  bookState = restingOrder.state;

  const book = buildSimulatedOrderBook(
    bookState.markets.BTCUSDT,
    bookState.openOrders,
    bookState.tick,
    8
  );
  assert.ok(book.asks.length >= 8);
  assert.ok(book.bids.length >= 8);
  assert.ok(book.bestAsk > book.bestBid);
  assert.ok(book.spread > 0 && book.spreadBps > 0);
  assert.ok(Number.isFinite(book.asks[0].quantity) && book.asks[0].quantity > 0);
  assert.ok(Number.isFinite(book.bids[0].quantity) && book.bids[0].quantity > 0);
  const userBidLevel = book.bids.find((lvl) => lvl.userOrderCount > 0);
  assert.ok(userBidLevel, 'User resting limit BUY order must appear on simulated order book');
  assert.equal(userBidLevel.userQty, 0.25);

  // 9. Transaction History Ledger derivation covers deposits, fills, reserves, cancellations, and settlements
  const txEntries = deriveAccountTransactions(state);
  assert.ok(txEntries.some((tx) => tx.type === 'VIRTUAL_DEPOSIT'));
  assert.ok(txEntries.some((tx) => tx.type === 'ORDER_FILL'));
  assert.ok(txEntries.some((tx) => tx.type === 'ORDER_CANCEL_RELEASE'));
  assert.ok(txEntries.some((tx) => tx.type === 'POSITION_SETTLEMENT'));

  const openResTx = deriveAccountTransactions(bookState);
  assert.ok(openResTx.some((tx) => tx.type === 'ORDER_RESERVE'));

  // 10. Phase 4: Live external quotes (24h volume/change), partial fallback honesty & historical OHLCV candles
  let liveState = createInitialEngineState({ startingBalance: 100_000 });
  const nowTs = Date.now();
  liveState = applyExternalQuotes(liveState, {
    BTCUSDT: {
      symbol: 'BTCUSDT',
      price: 71_250.5,
      open24h: 69_500,
      high24h: 72_100,
      low24h: 68_900,
      volume24h: 34_820.45,
      change24hPct: 2.52,
      dataSource: 'LIVE_PUBLIC',
      providerName: 'Binance Public Data API',
      timestamp: nowTs,
    },
  });
  assert.equal(liveState.marketDataMode, 'LIVE_PUBLIC_READONLY');
  assert.equal(liveState.markets.BTCUSDT.price, 71_250.5);
  assert.equal(liveState.markets.BTCUSDT.volume24h, 34_820.45);
  assert.equal(liveState.markets.BTCUSDT.change24hPct, 2.52);
  assert.equal(liveState.markets.BTCUSDT.dataSource, 'LIVE_PUBLIC');
  // Unfetched symbol must remain SIMULATED (never falsely labeled LIVE_PUBLIC)
  assert.equal(liveState.markets.ETHUSDT.dataSource, 'SIMULATED');

  // Execute paper BUY at live quoted price -> strictly simulated paper execution
  const livePaperOrder = placeOrder(liveState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.1,
    stopLoss: 69_000,
    takeProfit: 75_000,
  });
  assert.equal(livePaperOrder.accepted, true);
  liveState = livePaperOrder.state;
  assert.equal(liveState.mode, 'SIMULATED_PAPER');
  assert.equal(liveState.positions[0].entryPrice, 71_250.5);

  // Historical OHLCV candle replacement across timeframes recalculates signals cleanly
  const sampleOhlcv = Array.from({ length: 65 }, (_, idx) => {
    const base = 70_000 + idx * 45;
    return {
      timestamp: nowTs - (65 - idx) * 3_600_000,
      open: base - 20,
      high: base + 35,
      low: base - 45,
      close: base,
      volume: 1200 + idx * 10,
    };
  });
  liveState = applyHistoricalCandles(liveState, 'BTCUSDT', '1h', sampleOhlcv, {
    dataSource: 'LIVE_PUBLIC',
    providerName: 'Binance Public OHLCV',
    fetchedAt: nowTs,
  });
  assert.equal(liveState.candles.BTCUSDT['1h'].length, 65);
  assert.equal(liveState.candleDataSources?.BTCUSDT?.['1h'], 'LIVE_PUBLIC');
  const btcSignal = liveState.signals.find(
    (s) => s.symbol === 'BTCUSDT' && s.strategyId === 'rhino_confluence'
  );
  assert.ok(btcSignal && btcSignal.dataSource === 'LIVE_PUBLIC');

  // 11. Limit order execution simulation & Take-Profit auto-close + Portfolio Metrics
  let execState = createInitialEngineState({ startingBalance: 100_000 });
  const initSolPrice = execState.markets.SOLUSDT.price;
  const triggerBid = Number((initSolPrice * 0.92).toFixed(2));
  const targetTp = Number((triggerBid * 1.1).toFixed(2));
  const limitBuy = placeOrder(execState, {
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 50,
    limitPrice: triggerBid,
    stopLoss: Number((triggerBid * 0.96).toFixed(2)),
    takeProfit: targetTp,
  });
  assert.equal(limitBuy.accepted, true);
  execState = limitBuy.state;
  assert.equal(execState.openOrders.length, 1);
  assert.equal(execState.positions.length, 0);

  // Market drops to limit price -> limit order fills and opens LONG position
  execState = applyExternalQuotes(execState, {
    SOLUSDT: {
      symbol: 'SOLUSDT',
      price: Number((triggerBid * 0.995).toFixed(2)),
      dataSource: 'LIVE_PUBLIC',
      providerName: 'Test Feed',
      timestamp: Date.now(),
    },
  });
  assert.equal(execState.openOrders.length, 0);
  assert.equal(execState.positions.length, 1);
  assert.equal(execState.positions[0].entryPrice, triggerBid);

  // Check invested capital & portfolio valuation mid-trade
  const midPrice = Number((triggerBid * 1.05).toFixed(2));
  execState = applyExternalQuotes(execState, {
    SOLUSDT: {
      symbol: 'SOLUSDT',
      price: midPrice,
      dataSource: 'LIVE_PUBLIC',
      providerName: 'Test Feed',
      timestamp: Date.now() + 1000,
    },
  });
  const midMetrics = computePerformanceMetrics(execState);
  assert.ok(midMetrics.allocatedCapital > 0);
  assert.ok(midMetrics.totalUnrealizedPnl > 0);
  assert.ok(midMetrics.dailyPnl > 0);
  assert.ok(midMetrics.portfolioExposurePct > 0);

  // Market rallies past Take-Profit -> automatic TAKE_PROFIT exit & realized profit recorded
  execState = applyExternalQuotes(execState, {
    SOLUSDT: {
      symbol: 'SOLUSDT',
      price: Number((targetTp * 1.01).toFixed(2)),
      dataSource: 'LIVE_PUBLIC',
      providerName: 'Test Feed',
      timestamp: Date.now() + 2000,
    },
  });
  assert.equal(execState.positions.length, 0);
  assert.equal(execState.closedTrades.length, 1);
  assert.equal(execState.closedTrades[0].closeReason, 'TAKE_PROFIT');
  assert.ok(execState.closedTrades[0].netPnl > 0);

  // 12. Risk management: maxPortfolioExposurePct & maxOpenPositions enforcement while permitting reductions
  let riskCapState = createInitialEngineState({ startingBalance: 100_000 });
  riskCapState = updateRiskSettings(riskCapState, {
    maxPortfolioExposurePct: 20,
    maxOpenPositions: 1,
    enforceRiskLimits: true,
  });
  // Trying to open >20% exposure (~$25k+ in BTC) must be rejected
  const overExposed = placeOrder(riskCapState, {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.4,
    stopLoss: riskCapState.markets.BTCUSDT.price * 0.99,
  });
  assert.equal(overExposed.accepted, false);

  // Valid small position within exposure limit succeeds
  const validPos = placeOrder(riskCapState, {
    symbol: 'ETHUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 2,
    stopLoss: riskCapState.markets.ETHUSDT.price * 0.98,
  });
  assert.equal(validPos.accepted, true);
  riskCapState = validPos.state;

  // Second distinct symbol blocked by maxOpenPositions = 1
  const blockedSecond = placeOrder(riskCapState, {
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 5,
    stopLoss: riskCapState.markets.SOLUSDT.price * 0.98,
  });
  assert.equal(blockedSecond.accepted, false);

  // Position-reducing SELL on existing LONG must still be accepted
  const reduceExisting = placeOrder(riskCapState, {
    symbol: 'ETHUSDT',
    side: 'SELL',
    type: 'MARKET',
    quantity: 1,
  });
  assert.equal(reduceExisting.accepted, true);
  assert.equal(reduceExisting.state.positions[0].quantity, 1);

  console.log('All unit tests passed successfully.');
}

runUnitTests();
