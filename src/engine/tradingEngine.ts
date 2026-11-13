import { createInitialMarketsAndCandles, roundToTick, stepMarketData, TIMEFRAMES, TIMEFRAME_MS } from './marketData.ts';
import type { PublicQuoteSnapshot } from './marketDataProvider.ts';
import {
  calculateSuggestedPositionSize,
  computePerformanceMetrics,
  DEFAULT_RISK_SETTINGS,
  validateOrder,
  validatePositionTargets,
} from './risk.ts';
import {
  DEFAULT_STRATEGIES,
  generateLatestSignals,
  isBuySignal,
  isSellSignal,
} from './strategies.ts';
import type {
  Candle,
  ClosedTrade,
  MarketDataMode,
  NotificationItem,
  OrderRecord,
  OrderRequest,
  Position,
  RiskSettings,
  StrategyConfig,
  StrategyId,
  StrategyTemplate,
  Timeframe,
  TradingEngineState,
} from './types.ts';

let uidCounter = 100;
function nextId(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

function appendNotification(
  notifications: NotificationItem[],
  item: Omit<NotificationItem, 'id' | 'read'>
): NotificationItem[] {
  const created: NotificationItem = {
    ...item,
    id: nextId('ntf'),
    read: false,
  };
  return [created, ...notifications].slice(0, 40);
}

function recordEquitySnapshot(state: TradingEngineState): TradingEngineState {
  const metrics = computePerformanceMetrics(state);
  const peakEquity = Math.max(state.peakEquity, metrics.totalEquity);
  const currentDd =
    peakEquity > 0 ? ((peakEquity - metrics.totalEquity) / peakEquity) * 100 : 0;
  const maxDrawdownPct = Math.max(state.maxDrawdownPct, currentDd);

  const lastPoint = state.equityHistory[state.equityHistory.length - 1];
  const shouldAppend =
    !lastPoint ||
    lastPoint.tick !== state.tick ||
    Math.abs(lastPoint.equity - metrics.totalEquity) > 0.01;

  const equityHistory = shouldAppend
    ? [
        ...state.equityHistory.slice(-199),
        {
          timestamp: state.lastUpdated,
          tick: state.tick,
          equity: metrics.totalEquity,
          cash: metrics.availableCash,
          unrealizedPnl: metrics.totalUnrealizedPnl,
        },
      ]
    : state.equityHistory;

  return {
    ...state,
    peakEquity: Number(peakEquity.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    equityHistory,
  };
}

export function createInitialEngineState(options?: {
  startingBalance?: number;
  seedDemoPositions?: boolean;
}): TradingEngineState {
  const startingBalance = options?.startingBalance ?? 100_000;
  const seedDemoPositions = options?.seedDemoPositions ?? false;
  const anchorTime = Date.UTC(2026, 10, 13, 14, 0, 0);
  const { markets, candles } = createInitialMarketsAndCandles(anchorTime);
  const strategies = DEFAULT_STRATEGIES.map((s) => ({
    ...s,
    params: { ...s.params },
    entryRules: [...s.entryRules],
    exitRules: [...s.exitRules],
  }));
  const symbols = Object.keys(markets);
  const signals = generateLatestSignals(strategies, candles, symbols);

  let state: TradingEngineState = {
    mode: 'SIMULATED_PAPER',
    marketDataMode: 'SIMULATED',
    tick: 1,
    lastUpdated: anchorTime,
    startingBalance,
    dayStartEquity: startingBalance,
    availableCash: startingBalance,
    peakEquity: startingBalance,
    maxDrawdownPct: 0,
    selectedSymbol: 'BTCUSDT',
    selectedTimeframe: '1h',
    markets,
    candles,
    positions: [],
    openOrders: [],
    orderHistory: [],
    closedTrades: [],
    strategies,
    signals,
    riskSettings: { ...DEFAULT_RISK_SETTINGS },
    equityHistory: [
      {
        timestamp: anchorTime,
        tick: 1,
        equity: startingBalance,
        cash: startingBalance,
        unrealizedPnl: 0,
      },
    ],
    notifications: [
      {
        id: nextId('ntf'),
        timestamp: anchorTime,
        type: 'SYSTEM',
        title: 'Simulated Paper Engine Ready',
        message: `Paper account initialized with $${startingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} virtual capital. All quotes are simulated.`,
        read: false,
      },
    ],
  };

  if (seedDemoPositions) {
    const btcOrder = placeOrder(state, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.25,
      stopLoss: Number((markets.BTCUSDT.price * 0.975).toFixed(2)),
      takeProfit: Number((markets.BTCUSDT.price * 1.05).toFixed(2)),
      strategyId: 'rhino_confluence',
    });
    state = btcOrder.state;
  }

  return state;
}

function executeFill(
  state: TradingEngineState,
  params: {
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    fillPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    strategyId: StrategyId | 'MANUAL';
    reservedCashToRelease?: number;
  }
): TradingEngineState {
  const {
    symbol,
    side,
    quantity,
    fillPrice,
    stopLoss,
    takeProfit,
    strategyId,
    reservedCashToRelease = 0,
  } = params;
  const feeRate = state.riskSettings.feeRate;
  const now = state.lastUpdated;

  let availableCash = state.availableCash + reservedCashToRelease;
  const positions = [...state.positions];
  let closedTrades = [...state.closedTrades];
  let notifications = [...state.notifications];

  let remainingQty = quantity;

  if (side === 'BUY') {
    const shortIdx = positions.findIndex((p) => p.symbol === symbol && p.side === 'SHORT');
    if (shortIdx !== -1 && remainingQty > 0) {
      const pos = positions[shortIdx];
      const closeQty = Math.min(remainingQty, pos.quantity);
      const ratio = closeQty / pos.quantity;
      const releasedMargin = pos.costBasis * ratio;
      const allocEntryFee = pos.entryFee * ratio;
      const exitFee = closeQty * fillPrice * feeRate;
      const grossPnl = (pos.entryPrice - fillPrice) * closeQty;
      const netPnl = grossPnl - allocEntryFee - exitFee;

      availableCash += Math.max(0, releasedMargin + grossPnl) - exitFee;

      closedTrades = [
        {
          id: nextId('trd'),
          symbol,
          side: 'SHORT',
          quantity: Number(closeQty.toFixed(6)),
          entryPrice: pos.entryPrice,
          exitPrice: fillPrice,
          grossPnl: Number(grossPnl.toFixed(2)),
          feesPaid: Number((allocEntryFee + exitFee).toFixed(2)),
          netPnl: Number(netPnl.toFixed(2)),
          returnPct: Number(((netPnl / Math.max(1e-6, releasedMargin)) * 100).toFixed(2)),
          openedAt: pos.openedAt,
          closedAt: now,
          closeReason: 'OPPOSITE_ORDER',
          strategyId: pos.strategyId,
        },
        ...closedTrades,
      ];

      if (closeQty >= pos.quantity - 1e-9) {
        positions.splice(shortIdx, 1);
      } else {
        positions[shortIdx] = {
          ...pos,
          quantity: Number((pos.quantity - closeQty).toFixed(6)),
          costBasis: pos.costBasis - releasedMargin,
          entryFee: pos.entryFee - allocEntryFee,
        };
      }
      remainingQty = Number((remainingQty - closeQty).toFixed(6));
    }

    if (remainingQty > 1e-9) {
      const notional = remainingQty * fillPrice;
      const fee = notional * feeRate;
      availableCash -= notional + fee;

      const longIdx = positions.findIndex((p) => p.symbol === symbol && p.side === 'LONG');
      if (longIdx !== -1) {
        const existing = positions[longIdx];
        const newQty = Number((existing.quantity + remainingQty).toFixed(6));
        const newCostBasis = existing.costBasis + notional;
        positions[longIdx] = {
          ...existing,
          quantity: newQty,
          entryPrice: newCostBasis / newQty,
          costBasis: newCostBasis,
          entryFee: existing.entryFee + fee,
          stopLoss: stopLoss ?? existing.stopLoss,
          takeProfit: takeProfit ?? existing.takeProfit,
        };
      } else {
        positions.push({
          id: nextId('pos'),
          symbol,
          side: 'LONG',
          quantity: Number(remainingQty.toFixed(6)),
          entryPrice: fillPrice,
          costBasis: notional,
          entryFee: fee,
          stopLoss,
          takeProfit,
          openedAt: now,
          strategyId,
        });
      }
    }
  } else {
    const longIdx = positions.findIndex((p) => p.symbol === symbol && p.side === 'LONG');
    if (longIdx !== -1 && remainingQty > 0) {
      const pos = positions[longIdx];
      const closeQty = Math.min(remainingQty, pos.quantity);
      const ratio = closeQty / pos.quantity;
      const allocCost = pos.costBasis * ratio;
      const allocEntryFee = pos.entryFee * ratio;
      const exitNotional = closeQty * fillPrice;
      const exitFee = exitNotional * feeRate;
      const grossPnl = (fillPrice - pos.entryPrice) * closeQty;
      const netPnl = grossPnl - allocEntryFee - exitFee;

      availableCash += exitNotional - exitFee;

      closedTrades = [
        {
          id: nextId('trd'),
          symbol,
          side: 'LONG',
          quantity: Number(closeQty.toFixed(6)),
          entryPrice: pos.entryPrice,
          exitPrice: fillPrice,
          grossPnl: Number(grossPnl.toFixed(2)),
          feesPaid: Number((allocEntryFee + exitFee).toFixed(2)),
          netPnl: Number(netPnl.toFixed(2)),
          returnPct: Number(((netPnl / Math.max(1e-6, allocCost)) * 100).toFixed(2)),
          openedAt: pos.openedAt,
          closedAt: now,
          closeReason: 'OPPOSITE_ORDER',
          strategyId: pos.strategyId,
        },
        ...closedTrades,
      ];

      if (closeQty >= pos.quantity - 1e-9) {
        positions.splice(longIdx, 1);
      } else {
        positions[longIdx] = {
          ...pos,
          quantity: Number((pos.quantity - closeQty).toFixed(6)),
          costBasis: pos.costBasis - allocCost,
          entryFee: pos.entryFee - allocEntryFee,
        };
      }
      remainingQty = Number((remainingQty - closeQty).toFixed(6));
    }

    if (remainingQty > 1e-9) {
      const notional = remainingQty * fillPrice;
      const fee = notional * feeRate;
      availableCash -= notional + fee;

      const shortIdx = positions.findIndex((p) => p.symbol === symbol && p.side === 'SHORT');
      if (shortIdx !== -1) {
        const existing = positions[shortIdx];
        const newQty = Number((existing.quantity + remainingQty).toFixed(6));
        const newCostBasis = existing.costBasis + notional;
        positions[shortIdx] = {
          ...existing,
          quantity: newQty,
          entryPrice: newCostBasis / newQty,
          costBasis: newCostBasis,
          entryFee: existing.entryFee + fee,
          stopLoss: stopLoss ?? existing.stopLoss,
          takeProfit: takeProfit ?? existing.takeProfit,
        };
      } else {
        positions.push({
          id: nextId('pos'),
          symbol,
          side: 'SHORT',
          quantity: Number(remainingQty.toFixed(6)),
          entryPrice: fillPrice,
          costBasis: notional,
          entryFee: fee,
          stopLoss,
          takeProfit,
          openedAt: now,
          strategyId,
        });
      }
    }
  }

  notifications = appendNotification(notifications, {
    timestamp: now,
    type: 'ORDER_FILLED',
    title: `${side} ${symbol} Filled`,
    message: `Executed ${quantity} ${symbol.replace('USDT', '')} @ $${fillPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
  });

  const nextState: TradingEngineState = {
    ...state,
    availableCash: Number(Math.max(0, availableCash).toFixed(6)),
    positions,
    closedTrades,
    notifications,
  };

  return recordEquitySnapshot(nextState);
}

export function placeOrder(
  state: TradingEngineState,
  req: OrderRequest
): { state: TradingEngineState; accepted: boolean; errors: string[]; order?: OrderRecord } {
  const validation = validateOrder(state, req);
  if (!validation.valid) {
    const rejected: OrderRecord = {
      id: nextId('ord'),
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      quantity: req.quantity,
      requestedPrice: validation.estimatedPrice,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      fee: 0,
      status: 'REJECTED',
      strategyId: req.strategyId ?? 'MANUAL',
      reservedCash: 0,
      createdAt: state.lastUpdated,
      updatedAt: state.lastUpdated,
      rejectReason: validation.errors[0],
    };

    return {
      state: {
        ...state,
        orderHistory: [rejected, ...state.orderHistory],
        notifications: appendNotification(state.notifications, {
          timestamp: state.lastUpdated,
          type: 'RISK_ALERT',
          title: 'Order Rejected',
          message: validation.errors[0],
        }),
      },
      accepted: false,
      errors: validation.errors,
      order: rejected,
    };
  }

  const marketPrice = state.markets[req.symbol].price;

  if (req.type === 'MARKET') {
    const fee = Number((req.quantity * marketPrice * state.riskSettings.feeRate).toFixed(2));
    const filledOrder: OrderRecord = {
      id: nextId('ord'),
      symbol: req.symbol,
      side: req.side,
      type: 'MARKET',
      quantity: req.quantity,
      requestedPrice: marketPrice,
      executedPrice: marketPrice,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      fee,
      status: 'FILLED',
      strategyId: req.strategyId ?? 'MANUAL',
      reservedCash: 0,
      createdAt: state.lastUpdated,
      updatedAt: state.lastUpdated,
    };

    const filledState = executeFill(
      {
        ...state,
        orderHistory: [filledOrder, ...state.orderHistory],
      },
      {
        orderId: filledOrder.id,
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        fillPrice: marketPrice,
        stopLoss: req.stopLoss,
        takeProfit: req.takeProfit,
        strategyId: req.strategyId ?? 'MANUAL',
      }
    );

    return { state: filledState, accepted: true, errors: [], order: filledOrder };
  }

  const limitPrice = req.limitPrice ?? marketPrice;
  const immediatelyMarketable =
    (req.side === 'BUY' && limitPrice >= marketPrice) ||
    (req.side === 'SELL' && limitPrice <= marketPrice);

  if (immediatelyMarketable) {
    const fee = Number((req.quantity * marketPrice * state.riskSettings.feeRate).toFixed(2));
    const filledOrder: OrderRecord = {
      id: nextId('ord'),
      symbol: req.symbol,
      side: req.side,
      type: 'LIMIT',
      quantity: req.quantity,
      requestedPrice: limitPrice,
      executedPrice: marketPrice,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      fee,
      status: 'FILLED',
      strategyId: req.strategyId ?? 'MANUAL',
      reservedCash: 0,
      createdAt: state.lastUpdated,
      updatedAt: state.lastUpdated,
    };
    const filledState = executeFill(
      {
        ...state,
        orderHistory: [filledOrder, ...state.orderHistory],
      },
      {
        orderId: filledOrder.id,
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        fillPrice: marketPrice,
        stopLoss: req.stopLoss,
        takeProfit: req.takeProfit,
        strategyId: req.strategyId ?? 'MANUAL',
      }
    );
    return { state: filledState, accepted: true, errors: [], order: filledOrder };
  }

  const reservedCash = validation.totalRequiredCash;
  const openOrder: OrderRecord = {
    id: nextId('ord'),
    symbol: req.symbol,
    side: req.side,
    type: 'LIMIT',
    quantity: req.quantity,
    requestedPrice: limitPrice,
    stopLoss: req.stopLoss,
    takeProfit: req.takeProfit,
    fee: 0,
    status: 'OPEN',
    strategyId: req.strategyId ?? 'MANUAL',
    reservedCash,
    createdAt: state.lastUpdated,
    updatedAt: state.lastUpdated,
  };

  const nextState: TradingEngineState = {
    ...state,
    availableCash: Number((state.availableCash - reservedCash).toFixed(6)),
    openOrders: [openOrder, ...state.openOrders],
    orderHistory: [openOrder, ...state.orderHistory],
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'SYSTEM',
      title: `Limit ${req.side} Resting`,
      message: `${req.quantity} ${req.symbol.replace('USDT', '')} @ $${limitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    }),
  };

  return { state: nextState, accepted: true, errors: [], order: openOrder };
}

export function cancelOrder(state: TradingEngineState, orderId: string): TradingEngineState {
  const target = state.openOrders.find((o) => o.id === orderId);
  if (!target) return state;

  const remainingOpen = state.openOrders.filter((o) => o.id !== orderId);
  const updatedHistory = state.orderHistory.map((o) =>
    o.id === orderId
      ? {
          ...o,
          status: 'CANCELLED' as const,
          reservedCash: 0,
          updatedAt: state.lastUpdated,
        }
      : o
  );

  return recordEquitySnapshot({
    ...state,
    availableCash: Number((state.availableCash + target.reservedCash).toFixed(6)),
    openOrders: remainingOpen,
    orderHistory: updatedHistory,
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'ORDER_CANCELLED',
      title: `Order Cancelled (${target.symbol})`,
      message: `Released $${target.reservedCash.toFixed(2)} reserved paper funds.`,
    }),
  });
}

export function closePosition(
  state: TradingEngineState,
  positionId: string,
  reason: ClosedTrade['closeReason'] = 'MANUAL',
  overridePrice?: number
): TradingEngineState {
  const posIdx = state.positions.findIndex((p) => p.id === positionId);
  if (posIdx === -1) return state;

  const pos = state.positions[posIdx];
  const fillPrice = overridePrice ?? state.markets[pos.symbol]?.price ?? pos.entryPrice;
  const feeRate = state.riskSettings.feeRate;
  const exitNotional = pos.quantity * fillPrice;
  const exitFee = exitNotional * feeRate;

  const grossPnl =
    pos.side === 'LONG'
      ? (fillPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - fillPrice) * pos.quantity;
  const netPnl = grossPnl - pos.entryFee - exitFee;

  let cashCredit = 0;
  if (pos.side === 'LONG') {
    cashCredit = exitNotional - exitFee;
  } else {
    cashCredit = Math.max(0, pos.costBasis + grossPnl) - exitFee;
  }

  const closedTrade: ClosedTrade = {
    id: nextId('trd'),
    symbol: pos.symbol,
    side: pos.side,
    quantity: pos.quantity,
    entryPrice: pos.entryPrice,
    exitPrice: fillPrice,
    grossPnl: Number(grossPnl.toFixed(2)),
    feesPaid: Number((pos.entryFee + exitFee).toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    returnPct: Number(((netPnl / Math.max(1e-6, pos.costBasis)) * 100).toFixed(2)),
    openedAt: pos.openedAt,
    closedAt: state.lastUpdated,
    closeReason: reason,
    strategyId: pos.strategyId,
  };

  const closeOrderRecord: OrderRecord = {
    id: nextId('ord'),
    symbol: pos.symbol,
    side: pos.side === 'LONG' ? 'SELL' : 'BUY',
    type: 'MARKET',
    quantity: pos.quantity,
    requestedPrice: fillPrice,
    executedPrice: fillPrice,
    fee: Number(exitFee.toFixed(2)),
    status: 'FILLED',
    strategyId: pos.strategyId,
    reservedCash: 0,
    createdAt: state.lastUpdated,
    updatedAt: state.lastUpdated,
  };

  const nextPositions = state.positions.filter((p) => p.id !== positionId);

  return recordEquitySnapshot({
    ...state,
    availableCash: Number(Math.max(0, state.availableCash + cashCredit).toFixed(6)),
    positions: nextPositions,
    orderHistory: [closeOrderRecord, ...state.orderHistory],
    closedTrades: [closedTrade, ...state.closedTrades],
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'POSITION_CLOSED',
      title: `${pos.symbol} ${pos.side} Closed (${reason.replace('_', ' ')})`,
      message: `Net P&L: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} @ $${fillPrice.toFixed(2)}`,
    }),
  });
}

export function partialClosePosition(
  state: TradingEngineState,
  positionId: string,
  closeFraction: number,
  reason: ClosedTrade['closeReason'] = 'MANUAL'
): TradingEngineState {
  if (!Number.isFinite(closeFraction) || closeFraction <= 0) return state;
  if (closeFraction >= 0.9999) {
    return closePosition(state, positionId, reason);
  }

  const posIdx = state.positions.findIndex((p) => p.id === positionId);
  if (posIdx === -1) return state;

  const pos = state.positions[posIdx];
  const minQty = state.markets[pos.symbol]?.minQty ?? 0.0001;
  const closeQty = Number((pos.quantity * closeFraction).toFixed(6));
  const remainingQty = Number((pos.quantity - closeQty).toFixed(6));

  if (closeQty < minQty || remainingQty < minQty) {
    return closePosition(state, positionId, reason);
  }

  const ratio = closeQty / pos.quantity;
  const fillPrice = state.markets[pos.symbol]?.price ?? pos.entryPrice;
  const feeRate = state.riskSettings.feeRate;
  const allocCost = pos.costBasis * ratio;
  const allocEntryFee = pos.entryFee * ratio;
  const exitNotional = closeQty * fillPrice;
  const exitFee = exitNotional * feeRate;

  const grossPnl =
    pos.side === 'LONG'
      ? (fillPrice - pos.entryPrice) * closeQty
      : (pos.entryPrice - fillPrice) * closeQty;
  const netPnl = grossPnl - allocEntryFee - exitFee;

  const cashCredit =
    pos.side === 'LONG'
      ? exitNotional - exitFee
      : Math.max(0, allocCost + grossPnl) - exitFee;

  const closedTrade: ClosedTrade = {
    id: nextId('trd'),
    symbol: pos.symbol,
    side: pos.side,
    quantity: closeQty,
    entryPrice: pos.entryPrice,
    exitPrice: fillPrice,
    grossPnl: Number(grossPnl.toFixed(2)),
    feesPaid: Number((allocEntryFee + exitFee).toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    returnPct: Number(((netPnl / Math.max(1e-6, allocCost)) * 100).toFixed(2)),
    openedAt: pos.openedAt,
    closedAt: state.lastUpdated,
    closeReason: reason,
    strategyId: pos.strategyId,
  };

  const closeOrderRecord: OrderRecord = {
    id: nextId('ord'),
    symbol: pos.symbol,
    side: pos.side === 'LONG' ? 'SELL' : 'BUY',
    type: 'MARKET',
    quantity: closeQty,
    requestedPrice: fillPrice,
    executedPrice: fillPrice,
    fee: Number(exitFee.toFixed(2)),
    status: 'FILLED',
    strategyId: pos.strategyId,
    reservedCash: 0,
    createdAt: state.lastUpdated,
    updatedAt: state.lastUpdated,
  };

  const nextPositions = state.positions.map((p) =>
    p.id === positionId
      ? {
          ...p,
          quantity: remainingQty,
          costBasis: p.costBasis - allocCost,
          entryFee: p.entryFee - allocEntryFee,
        }
      : p
  );

  return recordEquitySnapshot({
    ...state,
    availableCash: Number(Math.max(0, state.availableCash + cashCredit).toFixed(6)),
    positions: nextPositions,
    orderHistory: [closeOrderRecord, ...state.orderHistory],
    closedTrades: [closedTrade, ...state.closedTrades],
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'POSITION_CLOSED',
      title: `${pos.symbol} Partial Close (${Math.round(closeFraction * 100)}%)`,
      message: `Closed ${closeQty} ${pos.symbol.replace('USDT', '')} · Net P&L: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} @ $${fillPrice.toFixed(2)}`,
    }),
  });
}

export function updatePositionTargets(
  state: TradingEngineState,
  positionId: string,
  stopLoss?: number,
  takeProfit?: number
): { state: TradingEngineState; accepted: boolean; errors: string[] } {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) {
    return { state, accepted: false, errors: ['Open position not found.'] };
  }

  const cleanSl = stopLoss !== undefined && stopLoss > 0 ? stopLoss : undefined;
  const cleanTp = takeProfit !== undefined && takeProfit > 0 ? takeProfit : undefined;
  const currentPrice = state.markets[pos.symbol]?.price ?? pos.entryPrice;

  const check = validatePositionTargets(pos, currentPrice, cleanSl, cleanTp);
  if (!check.valid) {
    return { state, accepted: false, errors: check.errors };
  }

  const nextState: TradingEngineState = {
    ...state,
    positions: state.positions.map((p) =>
      p.id === positionId
        ? {
            ...p,
            stopLoss: cleanSl,
            takeProfit: cleanTp,
          }
        : p
    ),
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'SYSTEM',
      title: `Targets Updated (${pos.symbol})`,
      message: `SL: ${cleanSl !== undefined ? `$${cleanSl.toFixed(2)}` : 'None'} · TP: ${cleanTp !== undefined ? `$${cleanTp.toFixed(2)}` : 'None'}`,
    }),
  };

  return { state: nextState, accepted: true, errors: [] };
}

function evaluateRestingAndStops(state: TradingEngineState): TradingEngineState {
  let nextState = state;
  const { markets, candles } = nextState;

  // 1. Check resting LIMIT orders against latest bar
  const ordersToFill: OrderRecord[] = [];
  const stillOpenOrders: OrderRecord[] = [];

  for (const order of nextState.openOrders) {
    const latestBar = candles[order.symbol]?.['1m']?.slice(-1)[0];
    const mktPrice = markets[order.symbol]?.price ?? order.requestedPrice;
    const low = latestBar ? Math.min(latestBar.low, mktPrice) : mktPrice;
    const high = latestBar ? Math.max(latestBar.high, mktPrice) : mktPrice;

    const triggered =
      (order.side === 'BUY' && low <= order.requestedPrice) ||
      (order.side === 'SELL' && high >= order.requestedPrice);

    if (triggered) {
      ordersToFill.push(order);
    } else {
      stillOpenOrders.push(order);
    }
  }

  if (ordersToFill.length > 0) {
    nextState = {
      ...nextState,
      openOrders: stillOpenOrders,
    };

    for (const order of ordersToFill) {
      const fillPrice = order.requestedPrice;
      const fee = Number((order.quantity * fillPrice * nextState.riskSettings.feeRate).toFixed(2));
      nextState = {
        ...nextState,
        orderHistory: nextState.orderHistory.map((h) =>
          h.id === order.id
            ? {
                ...h,
                status: 'FILLED' as const,
                executedPrice: fillPrice,
                fee,
                reservedCash: 0,
                updatedAt: nextState.lastUpdated,
              }
            : h
        ),
      };

      nextState = executeFill(nextState, {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        fillPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        strategyId: order.strategyId,
        reservedCashToRelease: order.reservedCash,
      });
    }
  }

  // 2. Check open positions for Stop-Loss / Take-Profit triggers
  for (const pos of [...nextState.positions]) {
    const latestBar = candles[pos.symbol]?.['1m']?.slice(-1)[0];
    const mktPrice = markets[pos.symbol]?.price ?? pos.entryPrice;
    const low = latestBar ? Math.min(latestBar.low, mktPrice) : mktPrice;
    const high = latestBar ? Math.max(latestBar.high, mktPrice) : mktPrice;

    if (pos.side === 'LONG') {
      if (pos.stopLoss !== undefined && low <= pos.stopLoss) {
        nextState = closePosition(nextState, pos.id, 'STOP_LOSS', pos.stopLoss);
        continue;
      }
      if (pos.takeProfit !== undefined && high >= pos.takeProfit) {
        nextState = closePosition(nextState, pos.id, 'TAKE_PROFIT', pos.takeProfit);
        continue;
      }
    } else {
      if (pos.stopLoss !== undefined && high >= pos.stopLoss) {
        nextState = closePosition(nextState, pos.id, 'STOP_LOSS', pos.stopLoss);
        continue;
      }
      if (pos.takeProfit !== undefined && low <= pos.takeProfit) {
        nextState = closePosition(nextState, pos.id, 'TAKE_PROFIT', pos.takeProfit);
        continue;
      }
    }
  }

  const dataSourceBySymbol: Record<string, 'SIMULATED' | 'LIVE_PUBLIC'> = {};
  for (const [sym, mkt] of Object.entries(nextState.markets)) {
    dataSourceBySymbol[sym] = mkt.dataSource;
  }

  const signals = generateLatestSignals(
    nextState.strategies,
    nextState.candles,
    Object.keys(nextState.markets),
    dataSourceBySymbol
  );

  nextState = {
    ...nextState,
    signals,
  };

  // 3. Opt-in automated strategy paper execution
  const autoStrategies = nextState.strategies.filter((s) => s.enabled && s.autoExecutePaper);
  if (autoStrategies.length > 0) {
    for (const strategy of autoStrategies) {
      const stratSignals = signals.filter(
        (s) => s.strategyId === strategy.id && s.action !== 'HOLD'
      );

      for (const sig of stratSignals) {
        const signalSide = isBuySignal(sig.action)
          ? 'BUY'
          : isSellSignal(sig.action)
            ? 'SELL'
            : null;
        if (!signalSide) continue;

        const targetPosSide = signalSide === 'BUY' ? 'LONG' : 'SHORT';
        const existingPos = nextState.positions.find((p) => p.symbol === sig.symbol);

        if (existingPos) {
          if (existingPos.side === targetPosSide) {
            // Avoid pyramiding same-direction exposure on every bar
            continue;
          }
          if (existingPos.strategyId === strategy.id) {
            // Opposing signal closes strategy's own opposite-side position cleanly
            nextState = closePosition(nextState, existingPos.id, 'STRATEGY');
            continue;
          }
          // Do not override a manual position or another strategy's position
          continue;
        }

        const hasOpenOrder = nextState.openOrders.some((o) => o.symbol === sig.symbol);
        if (hasOpenOrder) continue;

        const market = nextState.markets[sig.symbol];
        if (!market) continue;

        const metrics = computePerformanceMetrics(nextState);
        if (metrics.dailyLossLimitHit) break;

        let qty = calculateSuggestedPositionSize({
          equity: metrics.totalEquity,
          riskPct: Math.min(strategy.riskPerTradePct, nextState.riskSettings.maxRiskPerTradePct),
          entryPrice: market.price,
          stopLossPrice: sig.suggestedStopLoss,
          minQty: market.minQty,
        });

        if (qty < market.minQty) continue;

        // Cap quantity safely to available cash & remaining portfolio exposure headroom
        const maxExposureDollars = Math.max(
          0,
          metrics.totalEquity * (nextState.riskSettings.maxPortfolioExposurePct / 100) -
            metrics.allocatedCapital
        );
        const maxNotional = Math.min(
          nextState.availableCash / (1 + nextState.riskSettings.feeRate),
          maxExposureDollars
        );
        const maxQty = maxNotional / market.price;
        if (qty > maxQty) {
          const precision = Math.max(0, Math.round(-Math.log10(market.minQty)));
          qty = Number(Math.floor(maxQty * 10 ** precision) / 10 ** precision);
        }
        if (qty < market.minQty) continue;

        const orderRes = placeOrder(nextState, {
          symbol: sig.symbol,
          side: signalSide,
          type: 'MARKET',
          quantity: qty,
          stopLoss: sig.suggestedStopLoss,
          takeProfit: sig.suggestedTakeProfit,
          strategyId: strategy.id,
        });

        if (orderRes.accepted) {
          nextState = {
            ...orderRes.state,
            notifications: appendNotification(orderRes.state.notifications, {
              timestamp: orderRes.state.lastUpdated,
              type: 'SIGNAL',
              title: `[Auto-Paper] ${strategy.name}`,
              message: `${sig.action.replace('_', ' ')} ${sig.symbol} (${sig.confidence}%) executed ${qty} ${market.baseAsset} @ $${market.price.toFixed(2)}`,
            }),
          };
        }
      }
    }
  }

  return recordEquitySnapshot(nextState);
}

export function processMarketTick(
  state: TradingEngineState,
  seedSalt?: number
): TradingEngineState {
  const nextTick = state.tick + 1;
  const { markets, candles } = stepMarketData(state.markets, state.candles, nextTick, seedSalt);
  const nextTs =
    candles[state.selectedSymbol]?.['1m']?.slice(-1)[0]?.timestamp ??
    state.lastUpdated + 60_000;

  const steppedMarkets: typeof markets = {};
  for (const [sym, m] of Object.entries(markets)) {
    steppedMarkets[sym] = {
      ...m,
      dataSource: 'SIMULATED',
      providerName: 'Simulated Market Engine',
      lastQuoteAt: nextTs,
    };
  }

  return evaluateRestingAndStops({
    ...state,
    marketDataMode: 'SIMULATED',
    tick: nextTick,
    lastUpdated: nextTs,
    markets: steppedMarkets,
    candles,
    candleDataSources: {},
  });
}

export function applyExternalQuotes(
  state: TradingEngineState,
  quotes: Record<string, PublicQuoteSnapshot>
): TradingEngineState {
  const entries = Object.values(quotes);
  if (entries.length === 0) return state;

  const nextTick = state.tick + 1;
  const nextMarkets = { ...state.markets };
  const nextCandles = { ...state.candles };
  let latestTs = state.lastUpdated;

  // Honest labeling: any symbol NOT returned in this live quote batch reverts to SIMULATED
  // rather than misrepresenting stale/simulated prices as live.
  for (const [sym, existing] of Object.entries(nextMarkets)) {
    if (!quotes[sym] && existing.dataSource === 'LIVE_PUBLIC') {
      nextMarkets[sym] = {
        ...existing,
        dataSource: 'SIMULATED',
        providerName: 'Simulated Fallback (Quote Unavailable)',
      };
    }
  }

  for (const q of entries) {
    const existingMarket = nextMarkets[q.symbol];
    if (!existingMarket || !Number.isFinite(q.price) || q.price <= 0) continue;

    const newPrice = roundToTick(q.price, existingMarket.tickSize);
    const quoteTs = Number.isFinite(q.timestamp) && q.timestamp > 0 ? q.timestamp : Date.now();
    latestTs = Math.max(latestTs, quoteTs);

    const symbolCandles = { ...(nextCandles[q.symbol] ?? {}) } as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      const bars = symbolCandles[tf] ?? [];
      if (bars.length === 0) continue;
      const tfMs = TIMEFRAME_MS[tf];
      const bucketTs = Math.floor(quoteTs / tfMs) * tfMs;
      const last = bars[bars.length - 1];

      if (bucketTs <= last.timestamp) {
        // Update the active bar in place for accurate real-time candle formation
        const updatedLast: Candle = {
          ...last,
          high: Math.max(last.high, newPrice),
          low: Math.min(last.low, newPrice),
          close: newPrice,
        };
        symbolCandles[tf] = [...bars.slice(0, -1), updatedLast];
      } else {
        const bar: Candle = {
          timestamp: bucketTs,
          open: last.close,
          high: Math.max(last.close, newPrice),
          low: Math.min(last.close, newPrice),
          close: newPrice,
          volume: last.volume,
        };
        symbolCandles[tf] = [...bars.slice(-149), bar];
      }
    }
    nextCandles[q.symbol] = symbolCandles;

    const hourly = symbolCandles['1h'] ?? [];
    const lookback24 = hourly.slice(-24);
    const fallbackOpen24h = lookback24[0]?.open ?? existingMarket.open24h;
    const open24h =
      q.open24h !== undefined && Number.isFinite(q.open24h) && q.open24h > 0
        ? roundToTick(q.open24h, existingMarket.tickSize)
        : fallbackOpen24h;
    const high24h =
      q.high24h !== undefined && Number.isFinite(q.high24h) && q.high24h > 0
        ? roundToTick(Math.max(q.high24h, newPrice), existingMarket.tickSize)
        : Math.max(existingMarket.high24h, newPrice);
    const low24h =
      q.low24h !== undefined && Number.isFinite(q.low24h) && q.low24h > 0
        ? roundToTick(Math.min(q.low24h, newPrice), existingMarket.tickSize)
        : Math.min(existingMarket.low24h, newPrice);
    const volume24h =
      q.volume24h !== undefined && Number.isFinite(q.volume24h) && q.volume24h >= 0
        ? Number(q.volume24h.toFixed(2))
        : existingMarket.volume24h;
    const change24hPct =
      q.change24hPct !== undefined && Number.isFinite(q.change24hPct)
        ? Number(q.change24hPct.toFixed(2))
        : Number((((newPrice - open24h) / Math.max(open24h, 1e-9)) * 100).toFixed(2));

    nextMarkets[q.symbol] = {
      ...existingMarket,
      price: newPrice,
      open24h,
      high24h,
      low24h,
      volume24h,
      change24hPct,
      dataSource: q.dataSource,
      lastQuoteAt: quoteTs,
      providerName: q.providerName,
    };
  }

  return evaluateRestingAndStops({
    ...state,
    marketDataMode: 'LIVE_PUBLIC_READONLY',
    tick: nextTick,
    lastUpdated: latestTs,
    lastFeedSyncAt: latestTs,
    markets: nextMarkets,
    candles: nextCandles,
  });
}

export function applyHistoricalCandles(
  state: TradingEngineState,
  symbol: string,
  timeframe: Timeframe,
  rawCandles: Candle[],
  meta: { dataSource: 'SIMULATED' | 'LIVE_PUBLIC'; providerName?: string; fetchedAt?: number }
): TradingEngineState {
  const existingMarket = state.markets[symbol];
  if (!existingMarket || !Array.isArray(rawCandles) || rawCandles.length === 0) {
    return state;
  }

  const cleaned = rawCandles
    .filter(
      (c) =>
        Number.isFinite(c.timestamp) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.close > 0 &&
        Number.isFinite(c.volume) &&
        c.volume >= 0
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-200);

  if (cleaned.length === 0) return state;

  const nextCandles = {
    ...state.candles,
    [symbol]: {
      ...(state.candles[symbol] ?? {}),
      [timeframe]: cleaned,
    } as Record<Timeframe, Candle[]>,
  };

  const nextCandleSources: NonNullable<TradingEngineState['candleDataSources']> = {
    ...(state.candleDataSources ?? {}),
    [symbol]: {
      ...(state.candleDataSources?.[symbol] ?? {}),
      [timeframe]: meta.dataSource,
    },
  };

  const fetchedAt = meta.fetchedAt ?? Date.now();
  const latestBar = cleaned[cleaned.length - 1];
  const nextMarkets = { ...state.markets };

  // Synchronize spot price if live feed is active and market has not received a newer ticker quote
  if (
    meta.dataSource === 'LIVE_PUBLIC' &&
    latestBar &&
    (!existingMarket.lastQuoteAt || latestBar.timestamp >= existingMarket.lastQuoteAt - TIMEFRAME_MS[timeframe])
  ) {
    const roundedClose = roundToTick(latestBar.close, existingMarket.tickSize);
    nextMarkets[symbol] = {
      ...existingMarket,
      price: existingMarket.dataSource === 'LIVE_PUBLIC' ? existingMarket.price : roundedClose,
      dataSource: 'LIVE_PUBLIC',
      providerName: meta.providerName ?? existingMarket.providerName ?? 'Public OHLCV Feed',
      lastQuoteAt: existingMarket.lastQuoteAt ?? fetchedAt,
    };
  }

  return evaluateRestingAndStops({
    ...state,
    markets: nextMarkets,
    candles: nextCandles,
    candleDataSources: nextCandleSources,
    lastFeedSyncAt: fetchedAt,
  });
}

export function setMarketDataMode(
  state: TradingEngineState,
  mode: MarketDataMode
): TradingEngineState {
  const updatedMarkets: typeof state.markets = {};
  for (const [sym, m] of Object.entries(state.markets)) {
    updatedMarkets[sym] = {
      ...m,
      dataSource: mode === 'SIMULATED' ? 'SIMULATED' : m.dataSource,
      providerName: mode === 'SIMULATED' ? 'Simulated Market Engine' : m.providerName,
    };
  }
  return {
    ...state,
    marketDataMode: mode,
    markets: updatedMarkets,
    candleDataSources: mode === 'SIMULATED' ? {} : state.candleDataSources,
  };
}

export function selectMarketAndTimeframe(
  state: TradingEngineState,
  symbol?: string,
  timeframe?: Timeframe
): TradingEngineState {
  return {
    ...state,
    selectedSymbol: symbol && state.markets[symbol] ? symbol : state.selectedSymbol,
    selectedTimeframe: timeframe ?? state.selectedTimeframe,
  };
}

export function toggleStrategyEnabled(
  state: TradingEngineState,
  strategyId: StrategyId
): TradingEngineState {
  const strategies = state.strategies.map((s) =>
    s.id === strategyId
      ? {
          ...s,
          enabled: !s.enabled,
          autoExecutePaper: !s.enabled ? s.autoExecutePaper : false,
        }
      : s
  );
  return {
    ...state,
    strategies,
  };
}

export function toggleStrategyAutoExecute(
  state: TradingEngineState,
  strategyId: StrategyId
): TradingEngineState {
  const target = state.strategies.find((s) => s.id === strategyId);
  if (!target) return state;
  const nextAuto = !target.autoExecutePaper;

  const strategies = state.strategies.map((s) =>
    s.id === strategyId
      ? {
          ...s,
          enabled: nextAuto ? true : s.enabled,
          autoExecutePaper: nextAuto,
        }
      : s
  );

  return {
    ...state,
    strategies,
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'SYSTEM',
      title: `Auto-Paper ${nextAuto ? 'Enabled' : 'Disabled'}`,
      message: `${target.name} automated simulated signal routing ${nextAuto ? 'activated (paper only)' : 'paused'}.`,
    }),
  };
}

export function updateStrategyConfig(
  state: TradingEngineState,
  strategyId: StrategyId,
  patch: Partial<Omit<StrategyConfig, 'id' | 'params'>> & {
    params?: Partial<StrategyConfig['params']>;
  }
): TradingEngineState {
  const strategies = state.strategies.map((s) =>
    s.id === strategyId
      ? {
          ...s,
          ...patch,
          params: patch.params ? { ...s.params, ...patch.params } : s.params,
        }
      : s
  );
  const signals = generateLatestSignals(
    strategies,
    state.candles,
    Object.keys(state.markets)
  );
  return {
    ...state,
    strategies,
    signals,
  };
}

export function createCustomStrategy(
  state: TradingEngineState,
  input: {
    name: string;
    subtitle: string;
    description: string;
    template: StrategyTemplate;
    timeframe: Timeframe;
    riskPerTradePct: number;
    stopLossAtrMult: number;
    takeProfitRrMult: number;
    rsiBuyThreshold: number;
    rsiSellThreshold: number;
  }
): TradingEngineState {
  const id = nextId('strat');
  const newStrategy: StrategyConfig = {
    id,
    name: input.name.trim() || 'Custom Quant Strategy',
    subtitle: input.subtitle.trim() || `${input.template.toLowerCase()} rule set`,
    description: input.description.trim() || 'User-defined quantitative strategy configuration.',
    template: input.template,
    isCustom: true,
    enabled: true,
    autoExecutePaper: false,
    timeframe: input.timeframe,
    riskPerTradePct: input.riskPerTradePct,
    stopLossAtrMult: input.stopLossAtrMult,
    takeProfitRrMult: input.takeProfitRrMult,
    params: {
      fastEma: 20,
      slowEma: 50,
      rsiPeriod: 14,
      rsiBuyThreshold: input.rsiBuyThreshold,
      rsiSellThreshold: input.rsiSellThreshold,
      bbStdDev: 2,
    },
    entryRules: [
      `Template: ${input.template} on ${input.timeframe}`,
      `RSI Buy > ${input.rsiBuyThreshold} / Sell < ${input.rsiSellThreshold}`,
    ],
    exitRules: [
      `Stop-loss at ${input.stopLossAtrMult}× ATR(14)`,
      `Take-profit at ${input.takeProfitRrMult}× Risk/Reward`,
    ],
  };

  const strategies = [...state.strategies, newStrategy];
  const signals = generateLatestSignals(strategies, state.candles, Object.keys(state.markets));

  return {
    ...state,
    strategies,
    signals,
    notifications: appendNotification(state.notifications, {
      timestamp: state.lastUpdated,
      type: 'SYSTEM',
      title: 'Custom Strategy Created',
      message: `${newStrategy.name} (${newStrategy.timeframe}) activated in strategy engine.`,
    }),
  };
}

export function deleteCustomStrategy(
  state: TradingEngineState,
  strategyId: StrategyId
): TradingEngineState {
  const target = state.strategies.find((s) => s.id === strategyId);
  if (!target || !target.isCustom) return state;

  const strategies = state.strategies.filter((s) => s.id !== strategyId);
  const signals = generateLatestSignals(strategies, state.candles, Object.keys(state.markets));
  return {
    ...state,
    strategies,
    signals,
  };
}

export function updateRiskSettings(
  state: TradingEngineState,
  patch: Partial<RiskSettings>
): TradingEngineState {
  return {
    ...state,
    riskSettings: {
      ...state.riskSettings,
      ...patch,
    },
  };
}

export function markAllNotificationsRead(state: TradingEngineState): TradingEngineState {
  return {
    ...state,
    notifications: state.notifications.map((n) => ({ ...n, read: true })),
  };
}

export function resetPaperAccount(
  startingBalance = 100_000
): TradingEngineState {
  return createInitialEngineState({ startingBalance, seedDemoPositions: false });
}
