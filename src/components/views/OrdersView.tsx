import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, X, XCircle } from 'lucide-react';
import { computePerformanceMetrics } from '../../engine/risk.ts';
import type { NavSection, TradingEngineState } from '../../engine/types.ts';
import { formatAssetPrice, formatCurrency, formatDateTime } from '../../utils/format.ts';
import { OrderBook } from '../OrderBook.tsx';

interface OrdersViewProps {
  state: TradingEngineState;
  onSelectSymbol: (symbol: string) => void;
  onCancelOrder: (orderId: string) => void;
  onNavigate: (section: NavSection) => void;
}

type OrderFilter = 'ALL' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export const OrdersView: React.FC<OrdersViewProps> = ({
  state,
  onSelectSymbol,
  onCancelOrder,
  onNavigate,
}) => {
  const [statusFilter, setStatusFilter] = useState<OrderFilter>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);

  const filteredOrders = useMemo(() => {
    return state.orderHistory.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (symbolFilter !== 'ALL' && o.symbol !== symbolFilter) return false;
      return true;
    });
  }, [state.orderHistory, statusFilter, symbolFilter]);

  const filledCount = state.orderHistory.filter((o) => o.status === 'FILLED').length;
  const cancelledCount = state.orderHistory.filter((o) => o.status === 'CANCELLED').length;
  const rejectedCount = state.orderHistory.filter((o) => o.status === 'REJECTED').length;

  return (
    <div className="space-y-6">
      {/* Order Summary KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="terminal-card p-4 border-[#54451e]/80">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Resting Open Orders
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#f3dc8d] mt-1.5">
            {state.openOrders.length}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">
            Reserved Cash: {formatCurrency(metrics.reservedCash)}
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Filled Orders</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#37d69a] mt-1.5">
            {filledCount}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">Executed paper fills</div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Cancelled Orders
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#b8c4d7] mt-1.5">
            {cancelledCount}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">Funds released to cash</div>
        </div>

        <div className="terminal-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
            Risk-Rejected
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#ff667a] mt-1.5">
            {rejectedCount}
          </div>
          <div className="text-[11px] text-[#8190a8] mt-1">Blocked by validation</div>
        </div>
      </section>

      {/* Active Open Limit Orders + Live Order Book */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 terminal-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-3">
            <div>
              <h2 className="text-sm font-bold text-[#eef2f8]">
                Active Resting Limit Orders ({state.openOrders.length})
              </h2>
              <p className="text-xs text-[#8190a8]">
                Pending limit orders with reserved paper funds waiting for market price reach
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('TRADE')}
              className="gold-button px-3 py-1.5 rounded-lg text-xs"
            >
              Place New Order
            </button>
          </div>

          {state.openOrders.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8190a8]">
              No active resting limit orders. Place a Limit Order on the Trade terminal to queue one
              in the book.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3">Pair</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Limit Price</th>
                    <th className="py-2.5 px-3 text-right">Mark Price</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#1b2940]">
                  {state.openOrders.map((ord) => {
                    const mark = state.markets[ord.symbol]?.price ?? ord.requestedPrice;
                    return (
                      <tr key={ord.id} className="hover:bg-[#0e172a]/50">
                        <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                          {formatDateTime(ord.createdAt)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#eef2f8]">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(ord.symbol)}
                            className="hover:text-[#f3dc8d]"
                          >
                            {ord.symbol}
                          </button>
                        </td>
                        <td
                          className={`py-2.5 px-3 font-mono font-bold ${
                            ord.side === 'BUY' ? 'text-[#37d69a]' : 'text-[#ff667a]'
                          }`}
                        >
                          {ord.side}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {ord.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatAssetPrice(ord.requestedPrice)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                          {formatAssetPrice(mark)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#f3dc8d]">
                          {formatCurrency(ord.reservedCash)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onCancelOrder(ord.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a] hover:brightness-110 text-[11px] font-semibold"
                          >
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="xl:col-span-5 space-y-3">
          <div className="terminal-card p-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-[#8190a8] font-medium">Inspect Order Book Pair</span>
            <select
              aria-label="Order book pair"
              value={state.selectedSymbol}
              onChange={(e) => onSelectSymbol(e.target.value)}
              className="min-h-[36px] bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1 font-mono text-[#f3dc8d]"
            >
              {Object.values(state.markets).map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.baseAsset}/{m.quoteAsset}
                </option>
              ))}
            </select>
          </div>
          <OrderBook state={state} levels={8} />
        </div>
      </section>

      {/* Complete Order Ledger with Status Filtering */}
      <section className="terminal-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'ALL', label: `All (${state.orderHistory.length})` },
                { id: 'OPEN', label: `Open (${state.openOrders.length})` },
                { id: 'FILLED', label: `Filled (${filledCount})` },
                { id: 'CANCELLED', label: `Cancelled (${cancelledCount})` },
                { id: 'REJECTED', label: `Rejected (${rejectedCount})` },
              ] as { id: OrderFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === f.id
                    ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter orders by symbol"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="min-h-[36px] bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#eef2f8]"
          >
            <option value="ALL">All Pairs</option>
            {Object.keys(state.markets).map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#8190a8]">
            No orders match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Updated</th>
                  <th className="py-2.5 px-3">Order ID</th>
                  <th className="py-2.5 px-3">Pair</th>
                  <th className="py-2.5 px-3">Side / Type</th>
                  <th className="py-2.5 px-3 text-right">Quantity</th>
                  <th className="py-2.5 px-3 text-right">Req / Fill Price</th>
                  <th className="py-2.5 px-3 text-right">Fee</th>
                  <th className="py-2.5 px-3 text-right">Status / Detail</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#1b2940]">
                {filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                      {formatDateTime(ord.updatedAt)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#8190a8]">{ord.id}</td>
                    <td className="py-2.5 px-3 font-bold text-[#eef2f8]">{ord.symbol}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className={ord.side === 'BUY' ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                        {ord.side}
                      </span>{' '}
                      · {ord.type}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {ord.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatAssetPrice(ord.executedPrice ?? ord.requestedPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                      {formatCurrency(ord.fee)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          ord.status === 'FILLED'
                            ? 'text-[#37d69a]'
                            : ord.status === 'OPEN'
                              ? 'text-[#f3dc8d]'
                              : ord.status === 'REJECTED'
                                ? 'text-[#ff667a]'
                                : 'text-[#8190a8]'
                        }`}
                      >
                        {ord.status === 'FILLED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {ord.status === 'OPEN' && <Clock className="w-3.5 h-3.5" />}
                        {ord.status === 'REJECTED' && <XCircle className="w-3.5 h-3.5" />}
                        {ord.status}
                      </span>
                      {ord.rejectReason && (
                        <div className="text-[10px] text-[#ff667a] max-w-[260px] truncate ml-auto">
                          {ord.rejectReason}
                        </div>
                      )}
                    </td>
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
