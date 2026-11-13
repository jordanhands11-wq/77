import React, { useMemo } from 'react';
import { buildSimulatedOrderBook } from '../engine/orderBook.ts';
import type { OrderSide, TradingEngineState } from '../engine/types.ts';
import { formatAssetPrice, formatCurrency } from '../utils/format.ts';

interface OrderBookProps {
  state: TradingEngineState;
  levels?: number;
  onSelectPrice?: (price: number, side: OrderSide) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  state,
  levels = 7,
  onSelectPrice,
}) => {
  const market = state.markets[state.selectedSymbol] ?? Object.values(state.markets)[0];
  const book = useMemo(
    () => buildSimulatedOrderBook(market, state.openOrders, state.tick, levels),
    [market, state.openOrders, state.tick, levels]
  );

  const qtyDecimals = Math.max(0, Math.round(-Math.log10(market.minQty)));
  const askSharePct = Number((100 - book.bidImbalancePct).toFixed(1));

  return (
    <div className="terminal-card p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
        <div>
          <h3 className="text-sm font-bold text-[#eef2f8]">
            Order Book · {market.baseAsset}/{market.quoteAsset}
          </h3>
          <div className="text-[11px] text-[#8190a8]">
            {book.dataSource === 'LIVE_PUBLIC'
              ? 'Simulated Depth (Public Spot Ref)'
              : 'Simulated Market Depth'}{' '}
            · Tap level to set limit
          </div>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#54451e] bg-[#211c0e] text-[#f3dc8d] shrink-0">
          Spread {formatAssetPrice(book.spread)} ({book.spreadBps.toFixed(1)} bps)
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-[10px] uppercase tracking-wider text-[#71819a] px-1.5">
        <span>Price ({market.quoteAsset})</span>
        <span className="text-right">Size ({market.baseAsset})</span>
        <span className="text-right">Depth ({market.quoteAsset})</span>
      </div>

      {/* Asks (Sell Ladder) */}
      <div className="space-y-0.5" aria-label="Order book asks">
        {book.asks.map((lvl) => (
          <button
            key={`ask-${lvl.price}`}
            type="button"
            onClick={() => onSelectPrice?.(lvl.price, 'BUY')}
            className="relative w-full grid grid-cols-3 items-center px-1.5 py-1 rounded text-xs font-mono tabular-nums hover:bg-[#151e33]/80 transition-colors overflow-hidden text-left"
          >
            <div
              className="absolute inset-y-0 right-0 bg-[#ff667a]/12 pointer-events-none"
              style={{ width: `${lvl.depthPct}%` }}
            />
            <span className="relative z-10 text-[#ff667a] font-semibold flex items-center gap-1.5">
              {formatAssetPrice(lvl.price)}
              {lvl.userOrderCount > 0 && (
                <span
                  className="text-[9px] px-1 rounded bg-[#211c0e] border border-[#d4af37]/60 text-[#f3dc8d]"
                  title={`Your resting SELL limit order (${lvl.userQty} ${market.baseAsset})`}
                >
                  YOU
                </span>
              )}
            </span>
            <span className="relative z-10 text-right text-[#eef2f8]">
              {lvl.quantity.toFixed(Math.min(4, qtyDecimals))}
            </span>
            <span className="relative z-10 text-right text-[#8190a8]">
              {formatCurrency(lvl.totalNotional)}
            </span>
          </button>
        ))}
      </div>

      {/* Center Mid / Best Bid-Ask Strip */}
      <div className="bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
        <div className="flex items-center gap-2">
          <span className="text-[#8190a8] text-[10px] uppercase">Mid</span>
          <span className="text-sm font-bold text-[#f3dc8d]">
            {formatAssetPrice(book.midPrice)}
          </span>
        </div>
        <div className="text-[11px] text-[#8190a8]">
          Bid <span className="text-[#37d69a]">{formatAssetPrice(book.bestBid)}</span> / Ask{' '}
          <span className="text-[#ff667a]">{formatAssetPrice(book.bestAsk)}</span>
        </div>
      </div>

      {/* Bids (Buy Ladder) */}
      <div className="space-y-0.5" aria-label="Order book bids">
        {book.bids.map((lvl) => (
          <button
            key={`bid-${lvl.price}`}
            type="button"
            onClick={() => onSelectPrice?.(lvl.price, 'SELL')}
            className="relative w-full grid grid-cols-3 items-center px-1.5 py-1 rounded text-xs font-mono tabular-nums hover:bg-[#151e33]/80 transition-colors overflow-hidden text-left"
          >
            <div
              className="absolute inset-y-0 right-0 bg-[#37d69a]/12 pointer-events-none"
              style={{ width: `${lvl.depthPct}%` }}
            />
            <span className="relative z-10 text-[#37d69a] font-semibold flex items-center gap-1.5">
              {formatAssetPrice(lvl.price)}
              {lvl.userOrderCount > 0 && (
                <span
                  className="text-[9px] px-1 rounded bg-[#211c0e] border border-[#d4af37]/60 text-[#f3dc8d]"
                  title={`Your resting BUY limit order (${lvl.userQty} ${market.baseAsset})`}
                >
                  YOU
                </span>
              )}
            </span>
            <span className="relative z-10 text-right text-[#eef2f8]">
              {lvl.quantity.toFixed(Math.min(4, qtyDecimals))}
            </span>
            <span className="relative z-10 text-right text-[#8190a8]">
              {formatCurrency(lvl.totalNotional)}
            </span>
          </button>
        ))}
      </div>

      {/* Bid / Ask Depth Imbalance Bar */}
      <div className="pt-1 space-y-1 text-[10px] font-mono tabular-nums">
        <div className="flex justify-between text-[#8190a8]">
          <span className="text-[#37d69a]">Bid Depth {book.bidImbalancePct}%</span>
          <span className="text-[#ff667a]">Ask Depth {askSharePct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[#2c121a] overflow-hidden flex">
          <div
            className="bg-[#37d69a] h-full transition-all"
            style={{ width: `${book.bidImbalancePct}%` }}
          />
        </div>
      </div>
    </div>
  );
};
