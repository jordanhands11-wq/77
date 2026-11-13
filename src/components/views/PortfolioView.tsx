import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react';
import { computePerformanceMetrics, getPositionMarkValue } from '../../engine/risk.ts';
import type { NavSection, TradingEngineState } from '../../engine/types.ts';
import {
  formatAssetPrice,
  formatCurrency,
  formatDateTime,
  formatPercent,
  formatTimestamp,
} from '../../utils/format.ts';
import { EquityAreaChart } from '../VisualWidgets.tsx';

interface PortfolioViewProps {
  state: TradingEngineState;
  isAuthenticated?: boolean;
  onSimulatedTransfer?: (input: {
    direction: 'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL';
    amount: number;
    note?: string;
    idempotencyKey: string;
  }) => Promise<void>;
  onOpenAuthModal?: (mode: 'LOGIN' | 'REGISTER') => void;
  onClosePosition: (positionId: string) => void;
  onPartialClosePosition: (positionId: string, fraction: number) => void;
  onUpdatePositionTargets: (
    positionId: string,
    stopLoss?: number,
    takeProfit?: number
  ) => { accepted: boolean; errors: string[] };
  onSelectSymbolAndTrade: (symbol: string) => void;
  onNavigate: (section: NavSection) => void;
}

const ALLOCATION_COLORS = ['#d4af37', '#37d69a', '#6ea8fe', '#f2bd58', '#ff667a', '#a78bfa'];

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  state,
  isAuthenticated = false,
  onSimulatedTransfer,
  onOpenAuthModal,
  onClosePosition,
  onPartialClosePosition,
  onUpdatePositionTargets,
  onSelectSymbolAndTrade,
  onNavigate,
}) => {
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [slDraft, setSlDraft] = useState<string>('');
  const [tpDraft, setTpDraft] = useState<string>('');
  const [targetError, setTargetError] = useState<string | null>(null);

  const [transferDir, setTransferDir] = useState<'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL'>(
    'SIMULATED_DEPOSIT'
  );
  const [transferAmount, setTransferAmount] = useState<string>('5000');
  const [transferNote, setTransferNote] = useState<string>('');
  const [transferLoading, setTransferLoading] = useState<boolean>(false);
  const [transferMsg, setTransferMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);

  const allocations = useMemo(() => {
    const items: { label: string; value: number; color: string }[] = [
      {
        label: 'Cash & Reserved',
        value: metrics.availableCash + metrics.reservedCash,
        color: '#2b3f60',
      },
    ];
    state.positions.forEach((pos, idx) => {
      const mktPrice = state.markets[pos.symbol]?.price ?? pos.entryPrice;
      const { marketValue } = getPositionMarkValue(pos, mktPrice);
      items.push({
        label: `${(pos.symbol ?? '').replace('USDT', '')} (${pos.side})`,
        value: marketValue,
        color: ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length],
      });
    });

    const total = Math.max(1, items.reduce((s, i) => s + i.value, 0));
    return items.map((item) => ({
      ...item,
      pct: Number(((item.value / total) * 100).toFixed(1)),
    }));
  }, [metrics.availableCash, metrics.reservedCash, state.positions, state.markets]);

  const equityPoints = state.equityHistory.map((p) => ({
    label: formatTimestamp(p.timestamp),
    value: p.equity,
  }));

  // SVG Donut calculation
  const donutSize = 148;
  const donutR = 54;
  const donutCirc = 2 * Math.PI * donutR;
  let cumulativeOffset = 0;

  return (
    <div className="space-y-6">
      {/* Top Portfolio KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <div className="terminal-card p-4 border-[#54451e]/80">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Total Portfolio Value</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#f3dc8d] mt-1.5">
            {formatCurrency(metrics.totalEquity)}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">
            Base Capital: {formatCurrency(state.startingBalance)}
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Available Trading Funds
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#eef2f8] mt-1.5">
            {formatCurrency(metrics.availableCash)}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">
            Reserved: <span className="text-[#f3dc8d] font-mono">{formatCurrency(metrics.reservedCash)}</span>
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Invested Capital
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#eef2f8] mt-1.5">
            {formatCurrency(metrics.allocatedCapital)}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">
            Exposure: <span className="font-mono text-[#b8c4d7]">{metrics.portfolioExposurePct.toFixed(1)}%</span> · {state.positions.length} pos
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Daily P&amp;L</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              metrics.dailyPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {formatCurrency(metrics.dailyPnl, true)}
          </div>
          <div
            className={`text-[11px] font-mono tabular-nums mt-1 ${
              metrics.dailyReturnPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {formatPercent(metrics.dailyReturnPct)} session
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Overall P&amp;L</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              metrics.totalNetPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {formatCurrency(metrics.totalNetPnl, true)}
          </div>
          <div
            className={`text-[11px] font-mono tabular-nums mt-1 ${
              metrics.totalReturnPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {formatPercent(metrics.totalReturnPct)} · DD {metrics.maxDrawdownPct.toFixed(2)}%
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Realized / Unrealized
          </div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              metrics.totalRealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {formatCurrency(metrics.totalRealizedPnl, true)}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1 tabular-nums">
            Unrealized: <span className={metrics.totalUnrealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'}>{formatCurrency(metrics.totalUnrealizedPnl, true)}</span>
          </div>
        </div>
      </section>

      {/* Equity Performance Chart + Asset Allocation Donut */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 terminal-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-[#eef2f8]">Portfolio Equity Curve</h2>
              <p className="text-xs text-[#8190a8]">Historical simulated account equity across ticks &amp; executions</p>
            </div>
            <span className="text-xs font-mono text-[#d4af37] tabular-nums">
              Peak: {formatCurrency(state.peakEquity)}
            </span>
          </div>
          <EquityAreaChart points={equityPoints} height={210} />
        </div>

        <div className="lg:col-span-4 terminal-card p-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#eef2f8]">Asset Allocation</h2>
            <p className="text-xs text-[#8190a8]">Capital distribution across holdings &amp; cash</p>
          </div>

          <div className="flex items-center gap-5 my-4">
            <div className="relative shrink-0" style={{ width: donutSize, height: donutSize }}>
              <svg width={donutSize} height={donutSize} className="-rotate-90">
                {allocations.map((seg, i) => {
                  const dashLen = (seg.pct / 100) * donutCirc;
                  const dashOffset = -cumulativeOffset;
                  cumulativeOffset += dashLen;
                  return (
                    <circle
                      key={i}
                      cx={donutSize / 2}
                      cy={donutSize / 2}
                      r={donutR}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="16"
                      strokeDasharray={`${dashLen} ${donutCirc - dashLen}`}
                      strokeDashoffset={dashOffset}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span
                  className={`text-sm font-bold font-mono tabular-nums ${
                    metrics.totalReturnPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                  }`}
                >
                  {formatPercent(metrics.totalReturnPct)}
                </span>
                <span className="text-[10px] text-[#8190a8]">Return</span>
              </div>
            </div>

            <div className="flex-1 space-y-2 min-w-0">
              {allocations.map((seg, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs gap-2">
                  <span className="flex items-center gap-2 text-[#b8c4d7] truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="truncate">{seg.label}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[#eef2f8] font-semibold">
                    {seg.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('TRADE')}
            className="gold-button w-full py-2 rounded-lg text-xs"
          >
            Rebalance / Open Terminal
          </button>
        </div>
      </section>

      {/* Asset Balances Breakdown */}
      <section className="terminal-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-[#eef2f8]">Paper Account &amp; Asset Balances</h2>
            <p className="text-xs text-[#8190a8]">
              Available cash, reserved open-order margin, and simulated crypto holdings
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onNavigate('WALLET')}
              className="px-2.5 py-1 rounded border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] hover:border-[#d4af37]"
            >
              My Wallet
            </button>
            <button
              type="button"
              onClick={() => onNavigate('DEPOSIT')}
              className="px-2.5 py-1 rounded border border-[#1b5547] bg-[#102b27] text-[#37d69a]"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => onNavigate('WITHDRAW')}
              className="px-2.5 py-1 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a]"
            >
              Withdraw
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ORDERS')}
              className="px-2.5 py-1 rounded border border-[#1b2940] text-[#f3dc8d] hover:border-[#d4af37]"
            >
              View Open Orders ({state.openOrders.length})
            </button>
            <button
              type="button"
              onClick={() => onNavigate('HISTORY')}
              className="px-2.5 py-1 rounded border border-[#1b2940] text-[#b8c4d7] hover:text-[#eef2f8]"
            >
              Transactions →
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                <th className="py-2.5 px-3">Asset</th>
                <th className="py-2.5 px-3">Holding Type</th>
                <th className="py-2.5 px-3 text-right">Available / Qty</th>
                <th className="py-2.5 px-3 text-right">Reserved Funds</th>
                <th className="py-2.5 px-3 text-right">Mark Value (USD)</th>
                <th className="py-2.5 px-3 text-right">Portfolio Weight</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-[#1b2940]">
              <tr className="hover:bg-[#0e172a]/50">
                <td className="py-2.5 px-3 font-bold text-[#f3dc8d]">USDT (Paper Cash)</td>
                <td className="py-2.5 px-3 text-[#8190a8]">Settlement Currency</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#eef2f8]">
                  {formatCurrency(metrics.availableCash)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#f3dc8d]">
                  {formatCurrency(metrics.reservedCash)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                  {formatCurrency(metrics.availableCash + metrics.reservedCash)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#b8c4d7]">
                  {metrics.totalEquity > 0
                    ? `${(((metrics.availableCash + metrics.reservedCash) / metrics.totalEquity) * 100).toFixed(1)}%`
                    : '0.0%'}
                </td>
              </tr>
              {state.positions.map((pos) => {
                const mkt = state.markets[pos.symbol];
                const mark = mkt?.price ?? pos.entryPrice;
                const { marketValue } = getPositionMarkValue(pos, mark);
                const weight =
                  metrics.totalEquity > 0 ? (marketValue / metrics.totalEquity) * 100 : 0;
                return (
                  <tr key={`bal-${pos.id}`} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-bold text-[#eef2f8]">
                      {mkt?.baseAsset ?? pos.symbol.replace('USDT', '')}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#8190a8]">
                      {pos.side} Position ({pos.symbol})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#eef2f8]">
                      {pos.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                      $0.00
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(marketValue)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#b8c4d7]">
                      {weight.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Simulated Paper Deposits & Withdrawals (Virtual Ledger Only) */}
      <section className="terminal-card p-4 space-y-3 border-[#54451e]/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
          <div>
            <h2 className="text-sm font-bold text-[#eef2f8]">
              Simulated Paper Capital Transfers
            </h2>
            <p className="text-xs text-[#8190a8]">
              Virtual USDT ledger adjustments only — no real banking, cards, or real-money transfers
            </p>
          </div>
          <span className="text-[10px] font-mono text-[#f2bd58] uppercase tracking-wider">
            SIMULATED_PAPER_ONLY
          </span>
        </div>

        {isAuthenticated && onSimulatedTransfer ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setTransferMsg(null);
              const amt = Number(transferAmount);
              if (!Number.isFinite(amt) || amt <= 0) {
                setTransferMsg({ ok: false, text: 'Enter a valid positive virtual amount.' });
                return;
              }
              setTransferLoading(true);
              try {
                const key = `ui-trf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                await onSimulatedTransfer({
                  direction: transferDir,
                  amount: amt,
                  note: transferNote.trim() || undefined,
                  idempotencyKey: key,
                });
                setTransferNote('');
                setTransferMsg({
                  ok: true,
                  text: `${transferDir === 'SIMULATED_DEPOSIT' ? 'Deposited' : 'Withdrew'} ${formatCurrency(amt)} virtual paper funds cleanly.`,
                });
              } catch (err) {
                setTransferMsg({
                  ok: false,
                  text: err instanceof Error ? err.message : 'Simulated transfer failed.',
                });
              } finally {
                setTransferLoading(false);
              }
            }}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs"
          >
            <div className="md:col-span-3">
              <label className="block text-[#8190a8] mb-1">Direction</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setTransferDir('SIMULATED_DEPOSIT')}
                  className={`min-h-[38px] px-2 rounded-lg border font-semibold inline-flex items-center justify-center gap-1 ${
                    transferDir === 'SIMULATED_DEPOSIT'
                      ? 'bg-[#102b27] border-[#1b5547] text-[#37d69a]'
                      : 'bg-[#070c17] border-[#1b2940] text-[#8190a8]'
                  }`}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  Deposit
                </button>
                <button
                  type="button"
                  onClick={() => setTransferDir('SIMULATED_WITHDRAWAL')}
                  className={`min-h-[38px] px-2 rounded-lg border font-semibold inline-flex items-center justify-center gap-1 ${
                    transferDir === 'SIMULATED_WITHDRAWAL'
                      ? 'bg-[#2c121a] border-[#5d2331] text-[#ff667a]'
                      : 'bg-[#070c17] border-[#1b2940] text-[#8190a8]'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Withdraw
                </button>
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="block text-[#8190a8] mb-1">Virtual Amount (USD)</label>
              <input
                type="number"
                min={1}
                step="any"
                required
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-[#8190a8] mb-1">Ledger Note (Optional)</label>
              <input
                type="text"
                maxLength={120}
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="e.g. Margin top-up simulation"
                className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 text-[#eef2f8]"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={transferLoading}
                className="gold-button w-full min-h-[38px] rounded-lg text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {transferLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Record Transfer
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#070c17] border border-[#1b2940] rounded-lg p-3 text-xs">
            <span className="text-[#b8c4d7]">
              Sign in to record idempotent simulated paper deposits and withdrawals in the SQLite
              ledger.
            </span>
            {onOpenAuthModal && (
              <button
                type="button"
                onClick={() => onOpenAuthModal('LOGIN')}
                className="gold-button px-3.5 py-1.5 rounded-lg text-xs"
              >
                Sign In to Transfer
              </button>
            )}
          </div>
        )}

        {transferMsg && (
          <div
            className={`text-xs rounded-lg p-2.5 border ${
              transferMsg.ok
                ? 'bg-[#102b27]/70 border-[#1b5547] text-[#37d69a]'
                : 'bg-[#2c121a]/80 border-[#5d2331] text-[#ff667a]'
            }`}
          >
            {transferMsg.text}
          </div>
        )}
      </section>

      {/* Open Positions */}
      <section className="terminal-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#eef2f8]">Open Positions ({state.positions.length})</h2>
          <span className="text-xs text-[#8190a8] tabular-nums">
            Portfolio Exposure: {metrics.portfolioExposurePct.toFixed(1)}%
          </span>
        </div>
        {state.positions.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8190a8]">
            No open positions. Navigate to Trade to execute a simulated position.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Entry</th>
                  <th className="py-2.5 px-3 text-right">Current</th>
                  <th className="py-2.5 px-3 text-right">SL / TP</th>
                  <th className="py-2.5 px-3 text-right">Market Value</th>
                  <th className="py-2.5 px-3 text-right">Unrealized P&amp;L</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#1b2940]">
                {state.positions.map((pos) => {
                  const mark = state.markets[pos.symbol]?.price ?? pos.entryPrice;
                  const { marketValue, unrealizedPnl } = getPositionMarkValue(pos, mark);
                  const isEditing = editingPosId === pos.id;
                  return (
                    <React.Fragment key={pos.id}>
                      <tr className="hover:bg-[#0e172a]/50">
                        <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{pos.symbol}</td>
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
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(marketValue)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                            unrealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                          }`}
                        >
                          {formatCurrency(unrealizedPnl, true)}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectSymbolAndTrade(pos.symbol)}
                            className="px-2 py-1 rounded border border-[#1b2940] text-[#f3dc8d] hover:border-[#d4af37] text-[11px]"
                          >
                            Chart
                          </button>
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
                            className="px-2 py-1 rounded border border-[#1b2940] text-[#b8c4d7] hover:border-[#d4af37] hover:text-[#f3dc8d] text-[11px]"
                          >
                            {isEditing ? 'Cancel' : 'SL/TP'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onPartialClosePosition(pos.id, 0.5)}
                            className="px-2 py-1 rounded border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] text-[11px]"
                            title="Close 50% of position at market"
                          >
                            50%
                          </button>
                          <button
                            type="button"
                            onClick={() => onClosePosition(pos.id)}
                            className="px-2.5 py-1 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a] text-[11px] font-semibold"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-[#070c17]">
                          <td colSpan={9} className="px-3 py-2.5">
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
                                {targetError && <span className="text-[#ff667a]">{targetError}</span>}
                              </div>
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
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Closed Positions & Transaction History */}
      <section className="terminal-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#eef2f8]">Closed Positions &amp; Transaction Ledger</h2>
          <span className="text-xs text-[#8190a8]">Recent 20 entries</span>
        </div>
        {state.closedTrades.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8190a8]">
            No closed positions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Closed At</th>
                  <th className="py-2.5 px-3">Instrument</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Entry</th>
                  <th className="py-2.5 px-3 text-right">Exit</th>
                  <th className="py-2.5 px-3 text-right">Net P&amp;L</th>
                  <th className="py-2.5 px-3 text-right">Reason</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#1b2940]">
                {state.closedTrades.slice(0, 20).map((t) => (
                  <tr key={t.id} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                      {formatDateTime(t.closedAt)}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{t.symbol}</td>
                    <td className="py-2.5 px-3 font-mono">{t.side}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.quantity}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatAssetPrice(t.entryPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatAssetPrice(t.exitPrice)}
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
          </div>
        )}
      </section>
    </div>
  );
};
