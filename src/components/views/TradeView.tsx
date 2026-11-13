import React, { useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Search, Star, X } from 'lucide-react';
import { computePerformanceMetrics, getPositionMarkValue } from '../../engine/risk.ts';
import { isBuySignal, isSellSignal } from '../../engine/strategies.ts';
import type {
  MarketDataMode,
  MarketFeedStatus,
  NavSection,
  OrderRequest,
  OrderSide,
  Timeframe,
  TradingEngineState,
} from '../../engine/types.ts';
import {
  formatAssetPrice,
  formatCurrency,
  formatDateTime,
  formatPercent,
} from '../../utils/format.ts';
import { CandlestickChart } from '../CandlestickChart.tsx';
import { OrderBook } from '../OrderBook.tsx';
import { OrderTicket } from '../OrderTicket.tsx';
import { IntelligenceNeuralIcon, MiniSparkline, RadialGauge } from '../VisualWidgets.tsx';

interface TradeViewProps {
  state: TradingEngineState;
  chartType: 'CANDLE' | 'LINE';
  watchlistSymbols?: string[];
  feedStatus: MarketFeedStatus;
  feedError: string | null;
  lastFeedUpdatedAt: number | null;
  isLoadingCandles: boolean;
  candleError: string | null;
  onChartTypeChange: (mode: 'CANDLE' | 'LINE') => void;
  onToggleWatchlist?: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onSelectTimeframe: (tf: Timeframe) => void;
  onMarketDataModeChange: (mode: MarketDataMode) => void;
  onRefreshLiveFeed: () => Promise<boolean>;
  onSubmitOrder: (req: OrderRequest) => { accepted: boolean; errors: string[] };
  onCancelOrder: (orderId: string) => void;
  onClosePosition: (positionId: string) => void;
  onPartialClosePosition: (positionId: string, fraction: number) => void;
  onUpdatePositionTargets: (
    positionId: string,
    stopLoss?: number,
    takeProfit?: number
  ) => { accepted: boolean; errors: string[] };
  onNavigate: (section: NavSection) => void;
}

type ActivityTab = 'POSITIONS' | 'OPEN_ORDERS' | 'EXECUTED' | 'CANCELLED' | 'CLOSED_PNL';

export const TradeView: React.FC<TradeViewProps> = ({
  state,
  chartType,
  watchlistSymbols = [],
  feedStatus,
  feedError,
  lastFeedUpdatedAt,
  isLoadingCandles,
  candleError,
  onChartTypeChange,
  onToggleWatchlist,
  onSelectSymbol,
  onSelectTimeframe,
  onMarketDataModeChange,
  onRefreshLiveFeed,
  onSubmitOrder,
  onCancelOrder,
  onClosePosition,
  onPartialClosePosition,
  onUpdatePositionTargets,
  onNavigate,
}) => {
  const [activityTab, setActivityTab] = useState<ActivityTab>('POSITIONS');
  const [marketQuery, setMarketQuery] = useState<string>('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'WATCHLIST' | 'GAINERS' | 'LOSERS'>('ALL');
  const [limitPick, setLimitPick] = useState<{ price: number; side: OrderSide; seq: number } | null>(
    null
  );
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [slDraft, setSlDraft] = useState<string>('');
  const [tpDraft, setTpDraft] = useState<string>('');
  const [targetError, setTargetError] = useState<string | null>(null);
  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);
  const selectedMarket = state.markets[state.selectedSymbol] ?? Object.values(state.markets)[0];
  const selectedCandles =
    state.candles[selectedMarket.symbol]?.[state.selectedTimeframe] ?? [];
  const selectedCandleSource =
    state.candleDataSources?.[selectedMarket.symbol]?.[state.selectedTimeframe] ?? 'SIMULATED';

  const equitySparkValues = state.equityHistory.slice(-24).map((e) => e.equity);
  const marketList = Object.values(state.markets);
  const watchlistSet = useMemo(() => new Set(watchlistSymbols), [watchlistSymbols]);
  const filteredMarkets = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    return marketList.filter((m) => {
      if (
        q &&
        !m.symbol.toLowerCase().includes(q) &&
        !m.name.toLowerCase().includes(q) &&
        !m.baseAsset.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (marketFilter === 'WATCHLIST') return watchlistSet.has(m.symbol);
      if (marketFilter === 'GAINERS') return m.change24hPct > 0;
      if (marketFilter === 'LOSERS') return m.change24hPct < 0;
      return true;
    });
  }, [marketList, marketQuery, marketFilter, watchlistSet]);

  const primarySignal =
    state.signals.find(
      (s) => s.symbol === state.selectedSymbol && s.strategyId === 'rhino_confluence'
    ) ?? state.signals.find((s) => s.symbol === state.selectedSymbol);

  const actionableSignals = state.signals.filter((s) => s.action !== 'HOLD').slice(0, 4);

  const executedOrders = state.orderHistory.filter((o) => o.status === 'FILLED');
  const cancelledOrders = state.orderHistory.filter(
    (o) => o.status === 'CANCELLED' || o.status === 'REJECTED'
  );

  return (
    <div className="space-y-6">
      {state.marketDataMode === 'LIVE_PUBLIC_READONLY' &&
        (feedStatus === 'UNAVAILABLE' || feedStatus === 'DELAYED' || feedError) && (
          <div className="rounded-xl border border-[#5c4a22] bg-[#2a2110]/70 px-4 py-2.5 text-xs text-[#f2bd58] flex flex-wrap items-center justify-between gap-2">
            <span>
              {feedError ??
                (feedStatus === 'DELAYED'
                  ? 'Live market quotes have not refreshed recently and may be delayed.'
                  : 'Live market feed is temporarily unavailable.')}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => void onRefreshLiveFeed()}
                className="underline font-semibold text-[#f3dc8d]"
              >
                Retry Live Sync
              </button>
              <button
                type="button"
                onClick={() => onMarketDataModeChange('SIMULATED')}
                className="underline text-[#b8c4d7]"
              >
                Switch to Simulated
              </button>
            </div>
          </div>
        )}

      {/* A. Portfolio Overview Strip */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <div className="lg:col-span-4 terminal-card p-4 border-[#54451e]/80 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#8190a8]">
              Account Equity · Total Balance
            </div>
            <div className="text-2xl xl:text-3xl font-extrabold font-mono tabular-nums text-[#eef2f8] mt-1.5">
              {formatCurrency(metrics.totalEquity)}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs font-mono tabular-nums">
              <span className={metrics.totalNetPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                {formatCurrency(metrics.totalNetPnl, true)} ({formatPercent(metrics.totalReturnPct)})
              </span>
              <span className="text-[#8190a8]">overall return</span>
            </div>
          </div>
          <MiniSparkline
            values={equitySparkValues.length > 1 ? equitySparkValues : [state.startingBalance, metrics.totalEquity]}
            color="#d4af37"
            width={106}
            height={44}
          />
        </div>

        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#8190a8]">
              Available / Reserved
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#eef2f8] mt-2">
              {formatCurrency(metrics.availableCash)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1.5 tabular-nums">
              Res: {formatCurrency(metrics.reservedCash)} · Inv: {formatCurrency(metrics.allocatedCapital)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#8190a8]">
              Daily P&amp;L
            </div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-2 ${
                metrics.dailyPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
              }`}
            >
              {formatCurrency(metrics.dailyPnl, true)}
            </div>
            <div
              className={`text-[11px] font-mono tabular-nums mt-1.5 ${
                metrics.dailyReturnPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
              }`}
            >
              {formatPercent(metrics.dailyReturnPct)} session
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#8190a8]">
              Current / Total P&amp;L
            </div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-2 ${
                metrics.totalNetPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
              }`}
            >
              {formatCurrency(metrics.totalNetPnl, true)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1.5 tabular-nums">
              Unrealized: {formatCurrency(metrics.totalUnrealizedPnl, true)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#8190a8]">
              Positions / Risk
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#eef2f8] mt-2">
              {String(state.positions.length).padStart(2, '0')}{' '}
              <span className="text-xs font-normal text-[#8190a8]">
                / {String(state.riskSettings.maxOpenPositions).padStart(2, '0')} max
              </span>
            </div>
            <div className="text-[11px] text-[#37d69a] mt-1.5 tabular-nums">
              Risk {metrics.portfolioRiskPct.toFixed(1)}% · Exp {metrics.portfolioExposurePct.toFixed(0)}%
            </div>
          </div>
        </div>
      </section>

      {/* B. Live-Style Market Ticker Strip with Search & Filter */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#eef2f8]">Market Overview</h2>
            <span className="text-[11px] text-[#8190a8] font-mono">
              ({filteredMarkets.length}/{marketList.length})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8190a8] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Filter dashboard markets"
                value={marketQuery}
                onChange={(e) => setMarketQuery(e.target.value)}
                placeholder="Search pair..."
                className="w-36 sm:w-44 bg-[#070c17] border border-[#1b2940] rounded-lg pl-8 pr-2.5 py-1 text-xs text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
              />
            </div>
            <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5 text-[11px]">
              {(['ALL', 'WATCHLIST', 'GAINERS', 'LOSERS'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setMarketFilter(f)}
                  className={`px-2 py-0.5 rounded font-semibold transition-colors whitespace-nowrap ${
                    marketFilter === f
                      ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#54451e]'
                      : 'text-[#8190a8] hover:text-[#eef2f8]'
                  }`}
                >
                  {f === 'ALL'
                    ? 'All'
                    : f === 'WATCHLIST'
                      ? `Watchlist (${watchlistSymbols.length})`
                      : f === 'GAINERS'
                        ? 'Gainers'
                        : 'Losers'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('MARKETS')}
              className="text-xs text-[#d4af37] hover:text-[#f3dc8d] font-medium whitespace-nowrap"
            >
              All {marketList.length} Markets →
            </button>
          </div>
        </div>
        {filteredMarkets.length === 0 ? (
          <div className="terminal-card p-6 text-center text-xs text-[#8190a8]">
            {marketFilter === 'WATCHLIST' && !marketQuery.trim()
              ? 'Your watchlist is empty. Click the star icon on any market to track it here.'
              : `No trading pairs match "${marketQuery || marketFilter}".`}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
            {filteredMarkets.map((m) => {
              const isSelected = m.symbol === selectedMarket.symbol;
              const isWatched = watchlistSet.has(m.symbol);
              const spark = (state.candles[m.symbol]?.['1h'] ?? []).slice(-18).map((c) => c.close);
              const pos = m.change24hPct >= 0;
              return (
                <div
                  key={m.symbol}
                  onClick={() => onSelectSymbol(m.symbol)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectSymbol(m.symbol);
                    }
                  }}
                  className={`cursor-pointer text-left rounded-xl p-3 border transition-colors ${
                    isSelected
                      ? 'bg-gradient-to-br from-[#211c0e] to-[#0d1729] border-[#d4af37]/70'
                      : 'bg-[#0b1222] border-[#1b2940] hover:border-[#2e4366]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-[#eef2f8] flex items-center gap-1.5">
                      <span className="text-[#f3dc8d]">{m.badge}</span>
                      {m.baseAsset}
                    </span>
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center text-[11px] font-mono tabular-nums font-semibold ${
                          pos ? 'text-[#37d69a]' : 'text-[#ff667a]'
                        }`}
                      >
                        {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {Math.abs(m.change24hPct).toFixed(2)}%
                      </span>
                      {onToggleWatchlist && (
                        <button
                          type="button"
                          aria-label={isWatched ? `Remove ${m.symbol} from watchlist` : `Add ${m.symbol} to watchlist`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatchlist(m.symbol);
                          }}
                          className={`p-0.5 rounded transition-colors ${
                            isWatched ? 'text-[#f3dc8d]' : 'text-[#61708a] hover:text-[#b8c4d7]'
                          }`}
                        >
                          <Star className={`w-3 h-3 ${isWatched ? 'fill-[#f3dc8d]' : ''}`} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-bold font-mono tabular-nums text-[#eef2f8] mt-1.5">
                    {formatAssetPrice(m.price)}
                  </div>
                  <div className="mt-1.5">
                    <MiniSparkline
                      values={spark}
                      color={pos ? '#37d69a' : '#ff667a'}
                      width={96}
                      height={20}
                      fillArea={false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* C. Main Trading Chart + D. Order Ticket, Order Book & Active Signals */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 space-y-4">
          <CandlestickChart
            market={selectedMarket}
            candles={selectedCandles}
            timeframe={state.selectedTimeframe}
            onTimeframeChange={onSelectTimeframe}
            openPositions={state.positions}
            orderHistory={state.orderHistory}
            closedTrades={state.closedTrades}
            chartType={chartType}
            onChartTypeChange={onChartTypeChange}
            candleDataSource={selectedCandleSource}
            isLoadingCandles={isLoadingCandles}
            candleError={candleError}
            lastUpdatedAt={selectedMarket.lastQuoteAt ?? lastFeedUpdatedAt}
          />

          <OrderBook
            state={state}
            levels={7}
            onSelectPrice={(price, side) =>
              setLimitPick({ price, side, seq: Date.now() })
            }
          />
        </div>

        <div className="xl:col-span-4 space-y-4">
          <OrderTicket
            state={state}
            externalLimitSelection={limitPick}
            onSelectSymbol={onSelectSymbol}
            onSubmitOrder={onSubmitOrder}
          />

          {/* 77 Intelligence Live Signal Summary Card */}
          {primarySignal && (
            <div className="terminal-card p-4 border-[#54451e]/70 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <IntelligenceNeuralIcon size={44} />
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#d4af37] font-bold">
                      77 Intelligence · {(primarySignal.category ?? 'NEUTRAL').replace('_', ' ')}
                    </div>
                    <div className="text-sm font-bold text-[#eef2f8]">
                      {primarySignal.strategyName}
                    </div>
                    <div className="text-xs text-[#8190a8]">
                      {selectedMarket.baseAsset} · {primarySignal.timeframe} ·{' '}
                      <span
                        className={
                          isBuySignal(primarySignal.action)
                            ? 'text-[#37d69a] font-semibold'
                            : isSellSignal(primarySignal.action)
                              ? 'text-[#ff667a] font-semibold'
                              : 'text-[#f2bd58] font-semibold'
                        }
                      >
                        {(primarySignal.action ?? 'HOLD').replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
                <RadialGauge
                  valuePct={primarySignal.confidence}
                  label={`${primarySignal.confidence}%`}
                  sublabel={primarySignal.strengthLabel}
                  size={68}
                  color={
                    isBuySignal(primarySignal.action)
                      ? '#37d69a'
                      : isSellSignal(primarySignal.action)
                        ? '#ff667a'
                        : '#d4af37'
                  }
                />
              </div>

              {actionableSignals.length > 0 && (
                <div className="pt-2.5 border-t border-[#1b2940] space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#8190a8] font-semibold">
                    Active Cross-Market Signals ({actionableSignals.length})
                  </div>
                  {actionableSignals.map((sig) => (
                    <button
                      key={`${sig.strategyId}-${sig.symbol}`}
                      type="button"
                      onClick={() => onSelectSymbol(sig.symbol)}
                      className="w-full flex items-center justify-between text-xs py-1 px-2 rounded bg-[#070c17] hover:bg-[#0e172a] transition-colors"
                    >
                      <span className="font-mono font-semibold text-[#eef2f8]">
                        {(sig.symbol ?? '').replace('USDT', '')} · {(sig.strategyName ?? '').split(' ')[0]}
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          isBuySignal(sig.action) ? 'text-[#37d69a]' : 'text-[#ff667a]'
                        }`}
                      >
                        {(sig.action ?? 'HOLD').replace('_', ' ')} ({sig.confidence}%)
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-[#1b2940] flex items-center justify-between text-xs">
                <span className="text-[#8190a8] truncate pr-2">
                  {primarySignal.reasons?.[0] ?? ''}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('ANALYSIS')}
                  className="text-[#f3dc8d] hover:underline whitespace-nowrap shrink-0 font-semibold"
                >
                  View Analysis →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* E. Recent Activity: Open Positions, Open Orders, Executed, Cancelled, Closed P&L */}
      <section className="terminal-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3 mb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'POSITIONS', label: `Open Positions (${state.positions.length})` },
                { id: 'OPEN_ORDERS', label: `Open Orders (${state.openOrders.length})` },
                { id: 'EXECUTED', label: `Executed Orders (${executedOrders.length})` },
                { id: 'CANCELLED', label: `Cancelled / Rejected (${cancelledOrders.length})` },
                { id: 'CLOSED_PNL', label: `Realized P&L (${state.closedTrades.length})` },
              ] as { id: ActivityTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivityTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  activityTab === tab.id
                    ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                    : 'text-[#8190a8] hover:text-[#eef2f8] border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('HISTORY')}
            className="text-xs text-[#d4af37] hover:text-[#f3dc8d] font-medium whitespace-nowrap"
          >
            Full Performance &amp; History →
          </button>
        </div>

        {/* Tab 1: Open Positions */}
        {activityTab === 'POSITIONS' && (
          <div className="overflow-x-auto">
            {state.positions.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8190a8]">
                No open paper positions. Place a Market or Limit order in the Order Ticket to open a position.
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Entry Price</th>
                    <th className="py-2.5 px-3 text-right">Mark Price</th>
                    <th className="py-2.5 px-3 text-right">SL / TP</th>
                    <th className="py-2.5 px-3 text-right">Unrealized P&amp;L</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {state.positions.map((pos) => {
                    const mark = state.markets[pos.symbol]?.price ?? pos.entryPrice;
                    const { unrealizedPnl } = getPositionMarkValue(pos, mark);
                    const pct = (unrealizedPnl / Math.max(1e-6, pos.costBasis)) * 100;
                    const isEditing = editingPosId === pos.id;
                    return (
                      <React.Fragment key={pos.id}>
                        <tr className="hover:bg-[#0e172a]/50">
                          <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(pos.symbol)}
                              className="hover:text-[#f3dc8d]"
                            >
                              {pos.symbol}
                            </button>
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono font-bold ${
                              pos.side === 'LONG' ? 'text-[#37d69a]' : 'text-[#ff667a]'
                            }`}
                          >
                            {pos.side}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{pos.quantity}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {formatAssetPrice(pos.entryPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {formatAssetPrice(mark)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                            {pos.stopLoss ? formatAssetPrice(pos.stopLoss) : '—'} /{' '}
                            {pos.takeProfit ? formatAssetPrice(pos.takeProfit) : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                              unrealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                            }`}
                          >
                            {formatCurrency(unrealizedPnl, true)} ({formatPercent(pct)})
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditing) {
                                  setEditingPosId(null);
                                  setTargetError(null);
                                } else {
                                  setEditingPosId(pos.id);
                                  setSlDraft(pos.stopLoss !== undefined ? String(pos.stopLoss) : '');
                                  setTpDraft(pos.takeProfit !== undefined ? String(pos.takeProfit) : '');
                                  setTargetError(null);
                                }
                              }}
                              className="px-2 py-1 rounded border border-[#1b2940] text-[#f3dc8d] hover:border-[#d4af37] text-[11px]"
                            >
                              {isEditing ? 'Cancel' : 'SL/TP'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onPartialClosePosition(pos.id, 0.5)}
                              className="px-2 py-1 rounded border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] hover:brightness-110 text-[11px]"
                              title="Close 50% of this position at market"
                            >
                              50%
                            </button>
                            <button
                              type="button"
                              onClick={() => onClosePosition(pos.id)}
                              className="px-2.5 py-1 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a] hover:brightness-110 text-[11px] font-semibold"
                            >
                              Close
                            </button>
                          </td>
                        </tr>
                        {isEditing && (
                          <tr className="bg-[#070c17]">
                            <td colSpan={8} className="px-3 py-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="text-[#f3dc8d] font-semibold">
                                    Edit Targets ({pos.symbol} {pos.side} · Mark {formatAssetPrice(mark)})
                                  </span>
                                  <label className="flex items-center gap-1.5 text-[#8190a8]">
                                    SL:
                                    <input
                                      type="number"
                                      step="any"
                                      value={slDraft}
                                      onChange={(e) => setSlDraft(e.target.value)}
                                      placeholder="None"
                                      className="w-28 bg-[#0b1222] border border-[#1b2940] rounded px-2 py-1 font-mono text-[#eef2f8]"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-[#8190a8]">
                                    TP:
                                    <input
                                      type="number"
                                      step="any"
                                      value={tpDraft}
                                      onChange={(e) => setTpDraft(e.target.value)}
                                      placeholder="None"
                                      className="w-28 bg-[#0b1222] border border-[#1b2940] rounded px-2 py-1 font-mono text-[#eef2f8]"
                                    />
                                  </label>
                                  {targetError && (
                                    <span className="text-[#ff667a]">{targetError}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const parsedSl = slDraft.trim() ? Number(slDraft) : undefined;
                                      const parsedTp = tpDraft.trim() ? Number(tpDraft) : undefined;
                                      const res = onUpdatePositionTargets(pos.id, parsedSl, parsedTp);
                                      if (res.accepted) {
                                        setEditingPosId(null);
                                        setTargetError(null);
                                      } else {
                                        setTargetError(res.errors[0] ?? 'Invalid SL/TP target.');
                                      }
                                    }}
                                    className="gold-button px-3 py-1 rounded text-[11px]"
                                  >
                                    Save Targets
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 2: Open Orders */}
        {activityTab === 'OPEN_ORDERS' && (
          <div className="overflow-x-auto">
            {state.openOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8190a8]">
                No resting Limit orders. Switch the Order Ticket to Limit Order to place a resting order.
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Side / Type</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Limit Price</th>
                    <th className="py-2.5 px-3 text-right">Reserved Cash</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {state.openOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 text-[#8190a8] font-mono tabular-nums">
                        {formatDateTime(ord.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{ord.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={ord.side === 'BUY' ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                          {ord.side}
                        </span>{' '}
                        · {ord.type}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ord.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(ord.requestedPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(ord.reservedCash)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onCancelOrder(ord.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#1b2940] text-[#b8c4d7] hover:text-[#ff667a] hover:border-[#5d2331] text-[11px]"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Executed Orders */}
        {activityTab === 'EXECUTED' && (
          <div className="overflow-x-auto">
            {executedOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8190a8]">No executed orders yet.</div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Side / Type</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Fill Price</th>
                    <th className="py-2.5 px-3 text-right">Fee</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {executedOrders.slice(0, 15).map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 text-[#8190a8] font-mono tabular-nums">
                        {formatDateTime(ord.updatedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{ord.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={ord.side === 'BUY' ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                          {ord.side}
                        </span>{' '}
                        · {ord.type}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ord.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(ord.executedPrice ?? ord.requestedPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                        {formatCurrency(ord.fee)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#37d69a] font-semibold">FILLED</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 4: Cancelled / Rejected */}
        {activityTab === 'CANCELLED' && (
          <div className="overflow-x-auto">
            {cancelledOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8190a8]">No cancelled or rejected orders.</div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Price</th>
                    <th className="py-2.5 px-3 text-right">Status / Reason</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {cancelledOrders.slice(0, 15).map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 text-[#8190a8] font-mono tabular-nums">
                        {formatDateTime(ord.updatedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{ord.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">{ord.side}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ord.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(ord.requestedPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#f2bd58]">
                        {ord.status} {ord.rejectReason ? `· ${ord.rejectReason}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 5: Closed Trades / Realized P&L */}
        {activityTab === 'CLOSED_PNL' && (
          <div className="overflow-x-auto">
            {state.closedTrades.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8190a8]">
                No closed trades yet. Close an open position to realize P&amp;L.
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Closed</th>
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Entry → Exit</th>
                    <th className="py-2.5 px-3 text-right">Fees</th>
                    <th className="py-2.5 px-3 text-right">Net P&amp;L</th>
                    <th className="py-2.5 px-3 text-right">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {state.closedTrades.slice(0, 15).map((t) => (
                    <tr key={t.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 text-[#8190a8] font-mono tabular-nums">
                        {formatDateTime(t.closedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{t.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">{t.side}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(t.entryPrice)} → {formatAssetPrice(t.exitPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                        {formatCurrency(t.feesPaid)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                          t.netPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                        }`}
                      >
                        {formatCurrency(t.netPnl, true)} ({formatPercent(t.returnPct)})
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#8190a8]">{t.closeReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
