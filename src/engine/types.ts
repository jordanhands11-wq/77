export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type PositionSide = 'LONG' | 'SHORT';
export type OrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type NavSection =
  | 'TRADE'
  | 'PORTFOLIO'
  | 'WALLET'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'MARKETS'
  | 'ORDERS'
  | 'ANALYSIS'
  | 'STRATEGIES'
  | 'HISTORY'
  | 'SETTINGS'
  | 'ADMIN';

export type CoreStrategyId =
  | 'rhino_confluence'
  | 'momentum_trend_rider'
  | 'volatility_mean_reversion';

export type StrategyId = CoreStrategyId | (string & {});

export type StrategyTemplate = 'CONFLUENCE' | 'MOMENTUM' | 'MEAN_REVERSION';

export type SignalAction = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export type SignalCategory =
  | 'CONFLUENCE'
  | 'TREND_CHANGE'
  | 'MOMENTUM_SHIFT'
  | 'REVERSAL'
  | 'NEUTRAL';

export type MarketDataMode = 'SIMULATED' | 'LIVE_PUBLIC_READONLY';

export type MarketFeedStatus =
  | 'SIMULATED'
  | 'CONNECTING'
  | 'LIVE'
  | 'PARTIAL'
  | 'DELAYED'
  | 'UNAVAILABLE';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketInstrument {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  badge: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24hPct: number;
  volatility: number;
  tickSize: number;
  minQty: number;
  dataSource: 'SIMULATED' | 'LIVE_PUBLIC';
  lastQuoteAt?: number;
  providerName?: string;
}

export interface IndicatorSeries {
  sma20: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  rsi14: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHistogram: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  atr14: (number | null)[];
  vwap: (number | null)[];
  volumeSma20: (number | null)[];
}

export interface StrategyConfig {
  id: StrategyId;
  name: string;
  subtitle: string;
  description: string;
  template: StrategyTemplate;
  isCustom?: boolean;
  enabled: boolean;
  autoExecutePaper?: boolean;
  timeframe: Timeframe;
  riskPerTradePct: number;
  stopLossAtrMult: number;
  takeProfitRrMult: number;
  params: {
    fastEma: number;
    slowEma: number;
    rsiPeriod: number;
    rsiBuyThreshold: number;
    rsiSellThreshold: number;
    bbStdDev: number;
  };
  entryRules: string[];
  exitRules: string[];
}

export interface StrategySignal {
  strategyId: StrategyId;
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  action: SignalAction;
  category: SignalCategory;
  strengthLabel: 'Strong' | 'Moderate' | 'Neutral';
  confidence: number;
  price: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  reasons: string[];
  timestamp: number;
  dataSource: 'SIMULATED' | 'LIVE_PUBLIC';
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  returnPct: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_EXIT' | 'END_OF_DATA';
}

export interface BacktestResult {
  strategyId: StrategyId;
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  barsTested: number;
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  averageWin: number;
  averageLoss: number;
  equityCurve: { timestamp: number; equity: number }[];
  trades: BacktestTrade[];
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategyId?: StrategyId | 'MANUAL';
}

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  estimatedPrice: number;
  estimatedNotional: number;
  estimatedFee: number;
  totalRequiredCash: number;
  estimatedRiskAmount: number;
  estimatedRiskPct: number;
  estimatedRewardRiskRatio: number | null;
}

export interface OrderRecord {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  requestedPrice: number;
  executedPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  fee: number;
  status: OrderStatus;
  strategyId: StrategyId | 'MANUAL';
  reservedCash: number;
  createdAt: number;
  updatedAt: number;
  rejectReason?: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  costBasis: number;
  entryFee: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: number;
  strategyId: StrategyId | 'MANUAL';
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  feesPaid: number;
  netPnl: number;
  returnPct: number;
  openedAt: number;
  closedAt: number;
  closeReason: 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'OPPOSITE_ORDER' | 'STRATEGY';
  strategyId: StrategyId | 'MANUAL';
}

export interface RiskSettings {
  maxRiskPerTradePct: number;
  maxOpenPositions: number;
  dailyLossLimitPct: number;
  maxPortfolioExposurePct: number;
  feeRate: number;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  requireConfirmation: boolean;
  requireStopLoss: boolean;
  enforceRiskLimits: boolean;
}

export interface NotificationItem {
  id: string;
  timestamp: number;
  type: 'ORDER_FILLED' | 'ORDER_CANCELLED' | 'RISK_ALERT' | 'SIGNAL' | 'POSITION_CLOSED' | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
}

export interface EquityPoint {
  timestamp: number;
  tick: number;
  equity: number;
  cash: number;
  unrealizedPnl: number;
}

export interface TradingEngineState {
  mode: 'SIMULATED_PAPER';
  marketDataMode: MarketDataMode;
  tick: number;
  lastUpdated: number;
  startingBalance: number;
  dayStartEquity: number;
  availableCash: number;
  peakEquity: number;
  maxDrawdownPct: number;
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  markets: Record<string, MarketInstrument>;
  candles: Record<string, Record<Timeframe, Candle[]>>;
  candleDataSources?: Partial<Record<string, Partial<Record<Timeframe, 'SIMULATED' | 'LIVE_PUBLIC'>>>>;
  lastFeedSyncAt?: number;
  positions: Position[];
  openOrders: OrderRecord[];
  orderHistory: OrderRecord[];
  closedTrades: ClosedTrade[];
  strategies: StrategyConfig[];
  signals: StrategySignal[];
  riskSettings: RiskSettings;
  equityHistory: EquityPoint[];
  notifications: NotificationItem[];
}

export interface PerformanceMetrics {
  totalEquity: number;
  availableCash: number;
  reservedCash: number;
  allocatedCapital: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalNetPnl: number;
  totalReturnPct: number;
  dailyPnl: number;
  dailyReturnPct: number;
  portfolioExposurePct: number;
  portfolioRiskPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalProfit: number;
  totalLosses: number;
  bestTrade: number;
  worstTrade: number;
  averageWin: number;
  averageLoss: number;
  riskRewardRatio: number;
  profitFactor: number;
  maxDrawdownPct: number;
  dailyLossLimitHit: boolean;
}

export interface StrategyAttribution {
  strategyId: StrategyId | 'MANUAL';
  strategyName: string;
  enabled: boolean;
  autoExecutePaper: boolean;
  openPositionsCount: number;
  closedTradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  profitFactor: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  totalNotional: number;
  cumulativeQty: number;
  depthPct: number;
  userOrderCount: number;
  userQty: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  bidImbalancePct: number;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  dataSource: 'SIMULATED' | 'LIVE_PUBLIC';
}

export interface TransactionEntry {
  id: string;
  timestamp: number;
  type:
    | 'VIRTUAL_DEPOSIT'
    | 'ORDER_FILL'
    | 'ORDER_RESERVE'
    | 'ORDER_CANCEL_RELEASE'
    | 'POSITION_SETTLEMENT';
  symbol: string;
  description: string;
  cashDelta: number;
  fee: number;
  status: string;
}


