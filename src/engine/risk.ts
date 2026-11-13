import type {
  OrderRequest,
  OrderValidationResult,
  PerformanceMetrics,
  Position,
  RiskSettings,
  StrategyAttribution,
  TradingEngineState,
  TransactionEntry,
} from './types.ts';

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  maxRiskPerTradePct: 2.0,
  maxOpenPositions: 6,
  dailyLossLimitPct: 5.0,
  maxPortfolioExposurePct: 85.0,
  feeRate: 0.001,
  defaultStopLossPct: 2.0,
  defaultTakeProfitPct: 4.5,
  requireConfirmation: true,
  requireStopLoss: false,
  enforceRiskLimits: true,
};

export function getPositionMarkValue(position: Position, currentPrice: number): {
  marketValue: number;
  unrealizedPnl: number;
  notionalExposure: number;
} {
  if (position.side === 'LONG') {
    const marketValue = position.quantity * currentPrice;
    const unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
    return {
      marketValue,
      unrealizedPnl,
      notionalExposure: marketValue,
    };
  }
  const unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity;
  const marketValue = Math.max(0, position.costBasis + unrealizedPnl);
  return {
    marketValue,
    unrealizedPnl,
    notionalExposure: position.quantity * currentPrice,
  };
}

export function computePerformanceMetrics(state: TradingEngineState): PerformanceMetrics {
  const reservedCash = state.openOrders.reduce((sum, o) => sum + o.reservedCash, 0);

  let allocatedCapital = 0;
  let totalUnrealizedPnl = 0;
  let totalNotionalExposure = 0;
  let totalRiskDollars = 0;

  for (const pos of state.positions) {
    const marketPrice = state.markets[pos.symbol]?.price ?? pos.entryPrice;
    const { marketValue, unrealizedPnl, notionalExposure } = getPositionMarkValue(pos, marketPrice);
    allocatedCapital += marketValue;
    totalUnrealizedPnl += unrealizedPnl;
    totalNotionalExposure += notionalExposure;

    if (pos.stopLoss !== undefined) {
      const stopDist = Math.abs(marketPrice - pos.stopLoss);
      totalRiskDollars += stopDist * pos.quantity;
    } else {
      totalRiskDollars += notionalExposure * (state.riskSettings.defaultStopLossPct / 100);
    }
  }

  const totalEquity = state.availableCash + reservedCash + allocatedCapital;
  const totalRealizedPnl = state.closedTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const totalNetPnl = totalEquity - state.startingBalance;
  const totalReturnPct =
    state.startingBalance > 0 ? (totalNetPnl / state.startingBalance) * 100 : 0;

  const dailyPnl = totalEquity - state.dayStartEquity;
  const dailyReturnPct =
    state.dayStartEquity > 0 ? (dailyPnl / state.dayStartEquity) * 100 : 0;

  const portfolioExposurePct =
    totalEquity > 0 ? (totalNotionalExposure / totalEquity) * 100 : 0;
  const portfolioRiskPct = totalEquity > 0 ? (totalRiskDollars / totalEquity) * 100 : 0;

  const wins = state.closedTrades.filter((t) => t.netPnl > 0);
  const losses = state.closedTrades.filter((t) => t.netPnl <= 0);
  const totalProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

  const bestTrade =
    state.closedTrades.length > 0
      ? Math.max(...state.closedTrades.map((t) => t.netPnl))
      : 0;
  const worstTrade =
    state.closedTrades.length > 0
      ? Math.min(...state.closedTrades.map((t) => t.netPnl))
      : 0;

  const averageWin = wins.length > 0 ? totalProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  const winRatePct =
    state.closedTrades.length > 0 ? (wins.length / state.closedTrades.length) * 100 : 0;
  const riskRewardRatio = averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? 2.5 : 0;
  const profitFactor = totalLosses > 0 ? totalProfit / totalLosses : totalProfit > 0 ? 99.9 : 0;

  const dailyLossLimitHit = dailyReturnPct <= -state.riskSettings.dailyLossLimitPct;

  return {
    totalEquity: Number(totalEquity.toFixed(2)),
    availableCash: Number(state.availableCash.toFixed(2)),
    reservedCash: Number(reservedCash.toFixed(2)),
    allocatedCapital: Number(allocatedCapital.toFixed(2)),
    totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
    totalRealizedPnl: Number(totalRealizedPnl.toFixed(2)),
    totalNetPnl: Number(totalNetPnl.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    dailyPnl: Number(dailyPnl.toFixed(2)),
    dailyReturnPct: Number(dailyReturnPct.toFixed(2)),
    portfolioExposurePct: Number(portfolioExposurePct.toFixed(2)),
    portfolioRiskPct: Number(portfolioRiskPct.toFixed(2)),
    totalTrades: state.closedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: Number(winRatePct.toFixed(1)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalLosses: Number(totalLosses.toFixed(2)),
    bestTrade: Number(bestTrade.toFixed(2)),
    worstTrade: Number(worstTrade.toFixed(2)),
    averageWin: Number(averageWin.toFixed(2)),
    averageLoss: Number(averageLoss.toFixed(2)),
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(state.maxDrawdownPct.toFixed(2)),
    dailyLossLimitHit,
  };
}

export function calculateSuggestedPositionSize(params: {
  equity: number;
  riskPct: number;
  entryPrice: number;
  stopLossPrice: number;
  minQty: number;
}): number {
  const { equity, riskPct, entryPrice, stopLossPrice, minQty } = params;
  if (equity <= 0 || entryPrice <= 0 || riskPct <= 0) return 0;
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  if (stopDistance <= 0) return 0;
  const riskDollars = equity * (riskPct / 100);
  const rawQty = riskDollars / stopDistance;
  const precision = Math.max(0, Math.round(-Math.log10(minQty)));
  return Number(Math.max(minQty, rawQty).toFixed(precision));
}

export function validateOrder(
  state: TradingEngineState,
  req: OrderRequest
): OrderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const market = state.markets[req.symbol];

  if (!market) {
    return {
      valid: false,
      errors: [`Unsupported market symbol: ${req.symbol}`],
      warnings: [],
      estimatedPrice: 0,
      estimatedNotional: 0,
      estimatedFee: 0,
      totalRequiredCash: 0,
      estimatedRiskAmount: 0,
      estimatedRiskPct: 0,
      estimatedRewardRiskRatio: null,
    };
  }

  if (!Number.isFinite(req.quantity) || req.quantity <= 0) {
    errors.push('Order quantity must be a positive finite number.');
  } else if (req.quantity < market.minQty) {
    errors.push(`Minimum order size for ${market.symbol} is ${market.minQty} ${market.baseAsset}.`);
  }

  const estimatedPrice =
    req.type === 'LIMIT' ? (req.limitPrice ?? 0) : market.price;

  if (req.type === 'LIMIT' && (!Number.isFinite(estimatedPrice) || estimatedPrice <= 0)) {
    errors.push('Limit order requires a positive limit price.');
  }

  const estimatedNotional = Math.max(0, req.quantity * estimatedPrice);
  const estimatedFee = estimatedNotional * state.riskSettings.feeRate;

  const existingLong = state.positions.find(
    (p) => p.symbol === req.symbol && p.side === 'LONG'
  );
  const existingShort = state.positions.find(
    (p) => p.symbol === req.symbol && p.side === 'SHORT'
  );

  const isReducingLong = req.side === 'SELL' && existingLong && req.quantity <= existingLong.quantity;
  const isReducingShort = req.side === 'BUY' && existingShort && req.quantity <= existingShort.quantity;
  const isPureReduction = Boolean(isReducingLong || isReducingShort);

  let totalRequiredCash = 0;
  if (req.side === 'BUY') {
    if (existingShort) {
      const closingQty = Math.min(req.quantity, existingShort.quantity);
      const openingLongQty = Math.max(0, req.quantity - closingQty);
      totalRequiredCash =
        openingLongQty * estimatedPrice * (1 + state.riskSettings.feeRate) +
        closingQty * estimatedPrice * state.riskSettings.feeRate;
    } else {
      totalRequiredCash = estimatedNotional + estimatedFee;
    }
  } else {
    if (existingLong) {
      const closingQty = Math.min(req.quantity, existingLong.quantity);
      const openingShortQty = Math.max(0, req.quantity - closingQty);
      totalRequiredCash =
        openingShortQty > 0
          ? openingShortQty * estimatedPrice * (1 + state.riskSettings.feeRate)
          : 0;
    } else {
      totalRequiredCash = estimatedNotional + estimatedFee;
    }
  }

  if (totalRequiredCash > state.availableCash + 1e-6) {
    errors.push(
      `Insufficient available paper balance. Required $${totalRequiredCash.toFixed(2)}, available $${state.availableCash.toFixed(2)}.`
    );
  }

  const metrics = computePerformanceMetrics(state);

  if (!isPureReduction && metrics.dailyLossLimitHit) {
    errors.push(
      `Daily loss limit (-${state.riskSettings.dailyLossLimitPct}%) reached. New exposure blocked by risk controls.`
    );
  }

  const hasSameSymbolPos = state.positions.some((p) => p.symbol === req.symbol);
  if (!isPureReduction && !hasSameSymbolPos && state.positions.length >= state.riskSettings.maxOpenPositions) {
    errors.push(
      `Maximum open positions (${state.riskSettings.maxOpenPositions}) reached. Close a position first.`
    );
  }

  if (!isPureReduction && state.riskSettings.requireStopLoss && req.stopLoss === undefined) {
    errors.push('Stop-loss enforcement is active: specify a valid stop-loss price.');
  }

  if (req.stopLoss !== undefined) {
    if (!Number.isFinite(req.stopLoss) || req.stopLoss <= 0) {
      errors.push('Stop-loss must be a positive price.');
    } else if (req.side === 'BUY' && req.stopLoss >= estimatedPrice) {
      errors.push('Stop-loss for a BUY order must be below the entry price.');
    } else if (req.side === 'SELL' && !isReducingLong && req.stopLoss <= estimatedPrice) {
      errors.push('Stop-loss for a SELL/SHORT entry must be above the entry price.');
    }
  }

  if (req.takeProfit !== undefined) {
    if (!Number.isFinite(req.takeProfit) || req.takeProfit <= 0) {
      errors.push('Take-profit must be a positive price.');
    } else if (req.side === 'BUY' && req.takeProfit <= estimatedPrice) {
      errors.push('Take-profit for a BUY order must be above the entry price.');
    } else if (req.side === 'SELL' && !isReducingLong && req.takeProfit >= estimatedPrice) {
      errors.push('Take-profit for a SELL/SHORT entry must be below the entry price.');
    }
  }

  const stopDist =
    req.stopLoss !== undefined && estimatedPrice > 0
      ? Math.abs(estimatedPrice - req.stopLoss)
      : estimatedPrice * (state.riskSettings.defaultStopLossPct / 100);
  const estimatedRiskAmount = isPureReduction ? 0 : stopDist * req.quantity;
  const estimatedRiskPct =
    metrics.totalEquity > 0 ? (estimatedRiskAmount / metrics.totalEquity) * 100 : 0;

  let estimatedRewardRiskRatio: number | null = null;
  if (req.stopLoss !== undefined && req.takeProfit !== undefined && stopDist > 0) {
    const rewardDist = Math.abs(req.takeProfit - estimatedPrice);
    estimatedRewardRiskRatio = Number((rewardDist / stopDist).toFixed(2));
  }

  if (!isPureReduction && estimatedRiskPct > state.riskSettings.maxRiskPerTradePct) {
    const msg = `Trade risk (${estimatedRiskPct.toFixed(2)}%) exceeds max risk per trade (${state.riskSettings.maxRiskPerTradePct}%).`;
    if (state.riskSettings.enforceRiskLimits) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  if (!isPureReduction && metrics.totalEquity > 0) {
    const projectedExposure =
      ((metrics.allocatedCapital + estimatedNotional) / metrics.totalEquity) * 100;
    if (projectedExposure > state.riskSettings.maxPortfolioExposurePct) {
      const msg = `Projected portfolio exposure (${projectedExposure.toFixed(1)}%) exceeds ${state.riskSettings.maxPortfolioExposurePct}% threshold.`;
      if (state.riskSettings.enforceRiskLimits) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedPrice,
    estimatedNotional: Number(estimatedNotional.toFixed(2)),
    estimatedFee: Number(estimatedFee.toFixed(2)),
    totalRequiredCash: Number(totalRequiredCash.toFixed(2)),
    estimatedRiskAmount: Number(estimatedRiskAmount.toFixed(2)),
    estimatedRiskPct: Number(estimatedRiskPct.toFixed(2)),
    estimatedRewardRiskRatio,
  };
}

export function validatePositionTargets(
  position: Position,
  currentPrice: number,
  stopLoss?: number,
  takeProfit?: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (stopLoss !== undefined) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      errors.push('Stop-loss must be a positive price.');
    } else if (position.side === 'LONG' && stopLoss >= currentPrice) {
      errors.push('LONG stop-loss must be strictly below the current market price.');
    } else if (position.side === 'SHORT' && stopLoss <= currentPrice) {
      errors.push('SHORT stop-loss must be strictly above the current market price.');
    }
  }

  if (takeProfit !== undefined) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      errors.push('Take-profit must be a positive price.');
    } else if (position.side === 'LONG' && takeProfit <= currentPrice) {
      errors.push('LONG take-profit must be strictly above the current market price.');
    } else if (position.side === 'SHORT' && takeProfit >= currentPrice) {
      errors.push('SHORT take-profit must be strictly below the current market price.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function computeStrategyAttribution(state: TradingEngineState): StrategyAttribution[] {
  const buckets: {
    id: StrategyAttribution['strategyId'];
    name: string;
    enabled: boolean;
    autoExecutePaper: boolean;
  }[] = [
    ...state.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      autoExecutePaper: Boolean(s.autoExecutePaper),
    })),
    {
      id: 'MANUAL',
      name: 'Manual Execution',
      enabled: true,
      autoExecutePaper: false,
    },
  ];

  // Include any legacy/deleted custom strategy IDs found in history
  const knownIds = new Set(buckets.map((b) => b.id));
  for (const t of state.closedTrades) {
    if (!knownIds.has(t.strategyId)) {
      knownIds.add(t.strategyId);
      buckets.push({
        id: t.strategyId,
        name: String(t.strategyId),
        enabled: false,
        autoExecutePaper: false,
      });
    }
  }
  for (const p of state.positions) {
    if (!knownIds.has(p.strategyId)) {
      knownIds.add(p.strategyId);
      buckets.push({
        id: p.strategyId,
        name: String(p.strategyId),
        enabled: false,
        autoExecutePaper: false,
      });
    }
  }

  return buckets.map((bucket) => {
    const trades = state.closedTrades.filter((t) => t.strategyId === bucket.id);
    const openPos = state.positions.filter((p) => p.strategyId === bucket.id);

    const wins = trades.filter((t) => t.netPnl > 0);
    const losses = trades.filter((t) => t.netPnl <= 0);
    const grossWin = wins.reduce((sum, t) => sum + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
    const realizedPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);

    const unrealizedPnl = openPos.reduce((sum, pos) => {
      const mktPrice = state.markets[pos.symbol]?.price ?? pos.entryPrice;
      return sum + getPositionMarkValue(pos, mktPrice).unrealizedPnl;
    }, 0);

    const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const profitFactor =
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.9 : 0;

    return {
      strategyId: bucket.id,
      strategyName: bucket.name,
      enabled: bucket.enabled,
      autoExecutePaper: bucket.autoExecutePaper,
      openPositionsCount: openPos.length,
      closedTradesCount: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRatePct: Number(winRatePct.toFixed(1)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      netPnl: Number((realizedPnl + unrealizedPnl).toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
    };
  });
}

export function deriveAccountTransactions(state: TradingEngineState): TransactionEntry[] {
  const entries: TransactionEntry[] = [];

  for (const ord of state.orderHistory) {
    if (ord.status === 'FILLED') {
      const execPrice = ord.executedPrice ?? ord.requestedPrice;
      const notional = ord.quantity * execPrice;
      const cashDelta =
        ord.side === 'BUY' ? -(notional + ord.fee) : notional - ord.fee;
      entries.push({
        id: `tx-ord-${ord.id}`,
        timestamp: ord.updatedAt,
        type: 'ORDER_FILL',
        symbol: ord.symbol,
        description: `${ord.side} ${ord.quantity} ${ord.symbol.replace('USDT', '')} (${ord.type}) @ $${execPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
        cashDelta: Number(cashDelta.toFixed(2)),
        fee: ord.fee,
        status: 'FILLED',
      });
    } else if (ord.status === 'OPEN') {
      entries.push({
        id: `tx-res-${ord.id}`,
        timestamp: ord.createdAt,
        type: 'ORDER_RESERVE',
        symbol: ord.symbol,
        description: `Reserved funds for resting ${ord.side} Limit ${ord.quantity} ${ord.symbol.replace('USDT', '')} @ $${ord.requestedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
        cashDelta: Number((-ord.reservedCash).toFixed(2)),
        fee: 0,
        status: 'RESERVED',
      });
    } else if (ord.status === 'CANCELLED') {
      entries.push({
        id: `tx-can-${ord.id}`,
        timestamp: ord.updatedAt,
        type: 'ORDER_CANCEL_RELEASE',
        symbol: ord.symbol,
        description: `Cancelled ${ord.side} Limit ${ord.quantity} ${ord.symbol.replace('USDT', '')} — funds released`,
        cashDelta: 0,
        fee: 0,
        status: 'CANCELLED',
      });
    }
  }

  for (const tr of state.closedTrades) {
    entries.push({
      id: `tx-cls-${tr.id}`,
      timestamp: tr.closedAt,
      type: 'POSITION_SETTLEMENT',
      symbol: tr.symbol,
      description: `Settled ${tr.side} ${tr.symbol} (${tr.closeReason.replace('_', ' ')})`,
      cashDelta: Number(tr.netPnl.toFixed(2)),
      fee: tr.feesPaid,
      status: tr.netPnl >= 0 ? 'PROFIT' : 'LOSS',
    });
  }

  entries.push({
    id: 'tx-init-capital',
    timestamp: state.equityHistory[0]?.timestamp ?? state.lastUpdated,
    type: 'VIRTUAL_DEPOSIT',
    symbol: 'USDT',
    description: 'Initial simulated paper trading capital allocation',
    cashDelta: Number(state.startingBalance.toFixed(2)),
    fee: 0,
    status: 'PAPER_CREDIT',
  });

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}


