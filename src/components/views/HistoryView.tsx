import React, { useMemo, useState } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import {
  computePerformanceMetrics,
  computeStrategyAttribution,
  deriveAccountTransactions,
} from '../../engine/risk.ts';
import type { TradingEngineState } from '../../engine/types.ts';
import type { LedgerTransactionRecord } from '../../utils/api.ts';
import { formatAssetPrice, formatCurrency, formatDateTime, formatPercent } from '../../utils/format.ts';
import { RadialGauge } from '../VisualWidgets.tsx';

interface HistoryViewProps {
  state: TradingEngineState;
  persistedLedger?: LedgerTransactionRecord[];
  onEmergencyCloseAll: () => void;
}

type HistoryTab = 'TRADES' | 'ORDERS' | 'TRANSACTIONS';

export const HistoryView: React.FC<HistoryViewProps> = ({
  state,
  persistedLedger = [],
  onEmergencyCloseAll,
}) => {
  const [tab, setTab] = useState<HistoryTab>('TRADES');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);
  const strategyAttribution = useMemo(() => computeStrategyAttribution(state), [state]);
  const derivedTransactions = useMemo(() => deriveAccountTransactions(state), [state]);

  const unifiedTransactions = useMemo(() => {
    if (persistedLedger.length > 0) {
      return persistedLedger.map((tx) => ({
        id: tx.id,
        timestamp: tx.createdAt,
        type: tx.txType,
        symbol: tx.asset,
        description: tx.description,
        fee: 0,
        cashDelta: tx.amount,
        balanceAfter: tx.balanceAfter,
        status: tx.mode,
      }));
    }
    return derivedTransactions.map((tx) => ({
      ...tx,
      balanceAfter: null as number | null,
    }));
  }, [persistedLedger, derivedTransactions]);

  const strategyNameById = useMemo(() => {
    const map: Record<string, string> = { MANUAL: 'Manual Execution' };
    for (const s of state.strategies) {
      map[s.id] = s.name;
    }
    return map;
  }, [state.strategies]);

  const filteredTrades = state.closedTrades.filter(
    (t) =>
      (symbolFilter === 'ALL' || t.symbol === symbolFilter) &&
      (strategyFilter === 'ALL' || t.strategyId === strategyFilter)
  );
  const filteredOrders = state.orderHistory.filter(
    (o) =>
      (symbolFilter === 'ALL' || o.symbol === symbolFilter) &&
      (strategyFilter === 'ALL' || o.strategyId === strategyFilter)
  );
  const filteredTransactions = unifiedTransactions.filter(
    (tx) => symbolFilter === 'ALL' || tx.symbol === symbolFilter || tx.symbol === 'USDT'
  );

  const exportCsv = () => {
    const header =
      'ID,Symbol,Side,Quantity,EntryPrice,ExitPrice,Fees,NetPnl,ReturnPct,Strategy,Reason,ClosedAt\n';
    const rows = filteredTrades
      .map(
        (t) =>
          `${t.id},${t.symbol},${t.side},${t.quantity},${t.entryPrice},${t.exitPrice},${t.feesPaid},${t.netPnl},${t.returnPct},${strategyNameById[t.strategyId] ?? t.strategyId},${t.closeReason},${new Date(t.closedAt).toISOString()}`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `77-trade-it-history-tick-${state.tick}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Phase 5: Risk Management & Extended Performance Analytics */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Risk Exposure Donut Gauge */}
        <div className="lg:col-span-4 terminal-card p-5 border-[#54451e]/70 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-4">
            <RadialGauge
              valuePct={Math.min(100, metrics.portfolioExposurePct)}
              label={`${metrics.portfolioExposurePct.toFixed(1)}%`}
              sublabel={`Max ${state.riskSettings.maxPortfolioExposurePct}%`}
              size={112}
              color={
                metrics.portfolioExposurePct > state.riskSettings.maxPortfolioExposurePct
                  ? '#ff667a'
                  : metrics.portfolioExposurePct > 50
                    ? '#f2bd58'
                    : '#37d69a'
              }
            />
            <div className="flex-1 space-y-2 text-xs">
              <div className="text-[11px] uppercase tracking-wider text-[#d4af37] font-bold">
                Risk Controls
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Max Risk / Trade</span>
                <span className="font-mono font-semibold text-[#eef2f8]">
                  {state.riskSettings.maxRiskPerTradePct}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Daily Loss Limit</span>
                <span className="font-mono font-semibold text-[#eef2f8]">
                  -{state.riskSettings.dailyLossLimitPct}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Active Risk</span>
                <span className="font-mono font-semibold text-[#37d69a]">
                  {metrics.portfolioRiskPct.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Daily Status</span>
                <span
                  className={`font-semibold ${
                    metrics.dailyLossLimitHit ? 'text-[#ff667a]' : 'text-[#37d69a]'
                  }`}
                >
                  {metrics.dailyLossLimitHit ? 'LOCKED' : 'NOMINAL'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={state.positions.length === 0}
            onClick={onEmergencyCloseAll}
            className="w-full py-2.5 rounded-lg border border-[#5d2331] bg-[#2c121a] text-[#ff667a] hover:brightness-110 disabled:opacity-40 text-xs font-bold inline-flex items-center justify-center gap-2 transition-all"
          >
            <ShieldAlert className="w-4 h-4" />
            Emergency Flatten All Open Positions ({state.positions.length})
          </button>
        </div>

        {/* Complete Performance Analytics Grid */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Win Rate</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#37d69a] mt-2">
              {metrics.winRatePct}%
            </div>
            <div className="text-xs text-[#8190a8] mt-1 tabular-nums">
              {metrics.winningTrades}W · {metrics.losingTrades}L ({metrics.totalTrades} total)
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Avg Winning Trade</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#37d69a] mt-2">
              {formatCurrency(metrics.averageWin, true)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">
              Total Profit: {formatCurrency(metrics.totalProfit)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Avg Losing Trade</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#ff667a] mt-2">
              -{formatCurrency(metrics.averageLoss)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">
              Total Losses: -{formatCurrency(metrics.totalLosses)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Risk / Reward</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#f3dc8d] mt-2">
              1 : {metrics.riskRewardRatio.toFixed(2)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">
              Profit Factor: {metrics.profitFactor.toFixed(2)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Best Trade</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#37d69a] mt-2">
              {formatCurrency(metrics.bestTrade, true)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">Peak single trade gain</div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Worst Trade</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#ff667a] mt-2">
              {formatCurrency(metrics.worstTrade, true)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">Largest single loss</div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Max Drawdown</div>
            <div className="text-xl font-bold font-mono tabular-nums text-[#ff667a] mt-2">
              -{metrics.maxDrawdownPct.toFixed(2)}%
            </div>
            <div className="text-xs text-[#8190a8] mt-1">Peak-to-trough equity drop</div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Net Realized P&amp;L</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-2 ${
                metrics.totalRealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
              }`}
            >
              {formatCurrency(metrics.totalRealizedPnl, true)}
            </div>
            <div className="text-xs text-[#8190a8] mt-1">All closed positions</div>
          </div>
        </div>
      </section>

      {/* Strategy Performance Breakdown */}
      <section className="terminal-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[#1b2940] pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-[#eef2f8]">Per-Strategy Execution Attribution</h2>
            <p className="text-xs text-[#8190a8]">
              Compare win rate, profit factor, and net P&amp;L across strategies &amp; manual trades
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {strategyAttribution.map((row) => (
            <div
              key={row.strategyId}
              className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 space-y-1.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#eef2f8] truncate">{row.strategyName}</span>
                <span className="text-[10px] font-mono text-[#8190a8]">
                  {row.closedTradesCount} trades
                </span>
              </div>
              <div
                className={`text-base font-bold font-mono tabular-nums ${
                  row.netPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                }`}
              >
                {formatCurrency(row.netPnl, true)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#8190a8] font-mono tabular-nums">
                <span>Win {row.closedTradesCount > 0 ? `${row.winRatePct}%` : '—'}</span>
                <span>PF {row.closedTradesCount > 0 ? row.profitFactor.toFixed(2) : '—'}</span>
                <span>{row.openPositionsCount} open</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trade & Order History Table */}
      <section className="terminal-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab('TRADES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === 'TRADES'
                  ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                  : 'text-[#8190a8] hover:text-[#eef2f8]'
              }`}
            >
              Closed Trades ({filteredTrades.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('ORDERS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === 'ORDERS'
                  ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                  : 'text-[#8190a8] hover:text-[#eef2f8]'
              }`}
            >
              Order Audit Log ({filteredOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('TRANSACTIONS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === 'TRANSACTIONS'
                  ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                  : 'text-[#8190a8] hover:text-[#eef2f8]'
              }`}
            >
              Transaction History ({filteredTransactions.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter history by strategy"
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs text-[#eef2f8]"
            >
              <option value="ALL">All Strategies</option>
              <option value="MANUAL">Manual Execution</option>
              {state.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter history by instrument"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#eef2f8]"
            >
              <option value="ALL">All Instruments</option>
              {Object.keys(state.markets).map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={filteredTrades.length === 0}
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#f3dc8d] hover:border-[#d4af37] disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {tab === 'TRADES' ? (
          filteredTrades.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8190a8]">
              No closed trades recorded for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Closed</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Entry</th>
                    <th className="py-2.5 px-3 text-right">Exit</th>
                    <th className="py-2.5 px-3 text-right">Fees</th>
                    <th className="py-2.5 px-3 text-right">Net P&amp;L</th>
                    <th className="py-2.5 px-3">Strategy Used</th>
                    <th className="py-2.5 px-3 text-right">Trigger</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {filteredTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                        {formatDateTime(t.closedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#eef2f8]">{t.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">{t.side}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(t.entryPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(t.exitPrice)}
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
                      <td className="py-2.5 px-3 text-[#b8c4d7]">
                        {strategyNameById[t.strategyId] ?? t.strategyId}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#8190a8]">{t.closeReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'ORDERS' ? (
          filteredOrders.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8190a8]">No orders recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Order ID</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side / Type</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Price</th>
                    <th className="py-2.5 px-3 text-right">Fee</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                        {formatDateTime(o.updatedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#8190a8]">{o.id}</td>
                      <td className="py-2.5 px-3 font-bold text-[#eef2f8]">{o.symbol}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={o.side === 'BUY' ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                          {o.side}
                        </span>{' '}
                        · {o.type}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{o.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatAssetPrice(o.executedPrice ?? o.requestedPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                        {formatCurrency(o.fee)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          o.status === 'FILLED'
                            ? 'text-[#37d69a]'
                            : o.status === 'OPEN'
                              ? 'text-[#f3dc8d]'
                              : 'text-[#f2bd58]'
                        }`}
                      >
                        {o.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredTransactions.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#8190a8]">
            No wallet or trading transactions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Tx ID</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-right">Cash Delta</th>
                  <th className="py-2.5 px-3 text-right">Balance After</th>
                  <th className="py-2.5 px-3 text-right">Mode</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#1b2940]">
                {filteredTransactions.map((tx) => {
                  const isUsdAsset = tx.symbol === 'USDT' || tx.symbol.endsWith('USDT');
                  const formattedDelta = isUsdAsset
                    ? tx.cashDelta === 0
                      ? '$0.00'
                      : formatCurrency(tx.cashDelta, true)
                    : `${tx.cashDelta > 0 ? '+' : ''}${tx.cashDelta} ${tx.symbol}`;
                  const formattedBalAfter =
                    tx.balanceAfter === null
                      ? '—'
                      : isUsdAsset
                        ? formatCurrency(tx.balanceAfter)
                        : `${tx.balanceAfter} ${tx.symbol}`;
                  return (
                    <tr key={tx.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 font-mono text-[#8190a8]" title={tx.id}>
                        {tx.id.length > 16 ? `${tx.id.slice(0, 14)}…` : tx.id}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                        {formatDateTime(tx.timestamp)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#f3dc8d]">{tx.type}</td>
                      <td className="py-2.5 px-3 font-bold text-[#eef2f8]">{tx.symbol}</td>
                      <td className="py-2.5 px-3 text-[#b8c4d7]">{tx.description}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                          tx.cashDelta > 0
                            ? 'text-[#37d69a]'
                            : tx.cashDelta < 0
                              ? 'text-[#ff667a]'
                              : 'text-[#8190a8]'
                        }`}
                      >
                        {formattedDelta}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#eef2f8]">
                        {formattedBalAfter}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#b8c4d7] font-mono">
                        {tx.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
