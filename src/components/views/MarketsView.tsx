import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { isBuySignal, isSellSignal } from '../../engine/strategies.ts';
import type {
  MarketDataMode,
  MarketFeedStatus,
  TradingEngineState,
} from '../../engine/types.ts';
import {
  formatAssetPrice,
  formatDateTime,
  formatPercent,
  formatVolume,
} from '../../utils/format.ts';
import { MiniSparkline } from '../VisualWidgets.tsx';

interface MarketsViewProps {
  state: TradingEngineState;
  watchlistSymbols?: string[];
  feedStatus: MarketFeedStatus;
  feedProviderName: string;
  lastFeedUpdatedAt: number | null;
  feedError: string | null;
  isRefreshingFeed: boolean;
  onToggleWatchlist?: (symbol: string) => void;
  onTradeSymbol: (symbol: string) => void;
  onMarketDataModeChange: (mode: MarketDataMode) => void;
  onRefreshLiveFeed: () => Promise<boolean>;
}

type MarketFilter = 'ALL' | 'WATCHLIST' | 'GAINERS' | 'LOSERS' | 'ACTIONABLE';
type SortField = 'SYMBOL' | 'PRICE' | 'CHANGE' | 'VOLUME' | 'CONFIDENCE';
type SortDirection = 'asc' | 'desc';

export const MarketsView: React.FC<MarketsViewProps> = ({
  state,
  watchlistSymbols = [],
  feedStatus,
  feedProviderName,
  lastFeedUpdatedAt,
  feedError,
  isRefreshingFeed,
  onToggleWatchlist,
  onTradeSymbol,
  onMarketDataModeChange,
  onRefreshLiveFeed,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MarketFilter>('ALL');
  const [sortField, setSortField] = useState<SortField>('VOLUME');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const watchlistSet = useMemo(() => new Set(watchlistSymbols), [watchlistSymbols]);

  const signalBySymbol = useMemo(() => {
    const map = new Map<string, (typeof state.signals)[number]>();
    for (const s of state.signals) {
      if (s.strategyId === 'rhino_confluence' || !map.has(s.symbol)) {
        map.set(s.symbol, s);
      }
    }
    return map;
  }, [state.signals]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'SYMBOL' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-45" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 inline ml-1 text-[#f3dc8d]" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-1 text-[#f3dc8d]" />
    );
  };

  const markets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = Object.values(state.markets).filter((m) => {
      if (
        q &&
        !m.symbol.toLowerCase().includes(q) &&
        !m.name.toLowerCase().includes(q) &&
        !m.baseAsset.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === 'WATCHLIST') return watchlistSet.has(m.symbol);
      if (filter === 'GAINERS') return m.change24hPct > 0;
      if (filter === 'LOSERS') return m.change24hPct < 0;
      if (filter === 'ACTIONABLE') {
        const sig = state.signals.find((s) => s.symbol === m.symbol && s.action !== 'HOLD');
        return Boolean(sig);
      }
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortField === 'SYMBOL') {
        return a.symbol.localeCompare(b.symbol) * mult;
      }
      if (sortField === 'PRICE') {
        return (a.price - b.price) * mult;
      }
      if (sortField === 'CHANGE') {
        return (a.change24hPct - b.change24hPct) * mult;
      }
      if (sortField === 'CONFIDENCE') {
        const ca = signalBySymbol.get(a.symbol)?.confidence ?? 0;
        const cb = signalBySymbol.get(b.symbol)?.confidence ?? 0;
        return (ca - cb) * mult;
      }
      // VOLUME sorted by USD notional volume (volume24h * price) so BTC/ETH/SOL compare meaningfully
      const va = a.volume24h * a.price;
      const vb = b.volume24h * b.price;
      return (va - vb) * mult;
    });
  }, [state.markets, state.signals, query, filter, sortField, sortDir, signalBySymbol, watchlistSet]);

  const statusTone =
    feedStatus === 'LIVE'
      ? 'text-[#37d69a]'
      : feedStatus === 'PARTIAL' || feedStatus === 'DELAYED' || feedStatus === 'CONNECTING'
        ? 'text-[#f2bd58]'
        : feedStatus === 'UNAVAILABLE'
          ? 'text-[#ff667a]'
          : 'text-[#b8c4d7]';

  const statusLabel =
    feedStatus === 'LIVE'
      ? 'Live Public Feed'
      : feedStatus === 'PARTIAL'
        ? 'Live Partial (Fallback on Missing Pairs)'
        : feedStatus === 'DELAYED'
          ? 'Live Feed Delayed'
          : feedStatus === 'CONNECTING'
            ? 'Connecting Live Feed...'
            : feedStatus === 'UNAVAILABLE'
              ? 'Live Feed Unavailable'
              : 'Simulated Engine';

  return (
    <div className="space-y-5">
      {/* Top Feed Status & Search / Filter / Sort Bar */}
      <div className="terminal-card p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#eef2f8]">Tracked Cryptocurrency Markets</h2>
            <div className="text-xs text-[#8190a8] flex flex-wrap items-center gap-2 mt-0.5">
              <span className={`font-semibold ${statusTone}`}>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{feedProviderName}</span>
              {lastFeedUpdatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Updated {formatDateTime(lastFeedUpdatedAt)}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => onMarketDataModeChange('SIMULATED')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  state.marketDataMode === 'SIMULATED'
                    ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#54451e]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                Simulated
              </button>
              <button
                type="button"
                onClick={() => onMarketDataModeChange('LIVE_PUBLIC_READONLY')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  state.marketDataMode === 'LIVE_PUBLIC_READONLY'
                    ? 'bg-[#102b27] text-[#37d69a] border border-[#1b5547]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                Live Public Feed
              </button>
            </div>

            <button
              type="button"
              disabled={isRefreshingFeed}
              onClick={() => void onRefreshLiveFeed()}
              className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#1b2940] bg-[#070c17] text-xs font-semibold text-[#f3dc8d] hover:border-[#d4af37] inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingFeed ? 'animate-spin' : ''}`} />
              <span>{isRefreshingFeed ? 'Syncing...' : 'Refresh Quotes'}</span>
            </button>
          </div>
        </div>

        {feedError && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#ff667a] bg-[#2c121a]/80 border border-[#5d2331] rounded-lg px-3 py-2">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{feedError}</span>
            </span>
            {state.marketDataMode === 'LIVE_PUBLIC_READONLY' && (
              <button
                type="button"
                onClick={() => onMarketDataModeChange('SIMULATED')}
                className="text-[11px] underline text-[#f3dc8d] shrink-0"
              >
                Switch to Simulated Feed
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8190a8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search cryptocurrency pairs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search BTC, ETH, SOL..."
                className="bg-[#070c17] border border-[#1b2940] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
              />
            </div>

            <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5 overflow-x-auto">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'WATCHLIST', label: `Watchlist (${watchlistSymbols.length})` },
                  { id: 'GAINERS', label: 'Gainers' },
                  { id: 'LOSERS', label: 'Losers' },
                  { id: 'ACTIONABLE', label: 'Signals Active' },
                ] as { id: MarketFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    filter === f.id
                      ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#54451e]'
                      : 'text-[#8190a8] hover:text-[#eef2f8]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="markets-sort-select" className="text-[#8190a8]">
              Sort:
            </label>
            <select
              id="markets-sort-select"
              value={`${sortField}:${sortDir}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':') as [SortField, SortDirection];
                setSortField(field);
                setSortDir(dir);
              }}
              className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
            >
              <option value="VOLUME:desc">24h Notional Vol (High → Low)</option>
              <option value="CHANGE:desc">24h Change % (High → Low)</option>
              <option value="CHANGE:asc">24h Change % (Low → High)</option>
              <option value="PRICE:desc">Price (High → Low)</option>
              <option value="PRICE:asc">Price (Low → High)</option>
              <option value="CONFIDENCE:desc">Signal Confidence (High → Low)</option>
              <option value="SYMBOL:asc">Pair (A → Z)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="terminal-card p-4 overflow-x-auto">
        {markets.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#8190a8]">
            No instruments match your current search or filter.
          </div>
        ) : (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                <th className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('SYMBOL')}
                    className="hover:text-[#eef2f8] uppercase tracking-wider font-semibold"
                  >
                    Instrument {renderSortIcon('SYMBOL')}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('PRICE')}
                    className="hover:text-[#eef2f8] uppercase tracking-wider font-semibold"
                  >
                    Price {renderSortIcon('PRICE')}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('CHANGE')}
                    className="hover:text-[#eef2f8] uppercase tracking-wider font-semibold"
                  >
                    24h Change {renderSortIcon('CHANGE')}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">24h High / Low</th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('VOLUME')}
                    className="hover:text-[#eef2f8] uppercase tracking-wider font-semibold"
                  >
                    24h Volume {renderSortIcon('VOLUME')}
                  </button>
                </th>
                <th className="py-3 px-3 text-center">1H Trend</th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('CONFIDENCE')}
                    className="hover:text-[#eef2f8] uppercase tracking-wider font-semibold"
                  >
                    Rhino Confluence {renderSortIcon('CONFIDENCE')}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-[#1b2940]">
              {markets.map((m) => {
                const spark = (state.candles[m.symbol]?.['1h'] ?? []).slice(-24).map((c) => c.close);
                const sig = signalBySymbol.get(m.symbol);
                const pos = m.change24hPct >= 0;
                const isLivePair = m.dataSource === 'LIVE_PUBLIC';
                const isWatched = watchlistSet.has(m.symbol);

                return (
                  <tr key={m.symbol} className="hover:bg-[#0e172a]/60">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        {onToggleWatchlist && (
                          <button
                            type="button"
                            aria-label={isWatched ? `Remove ${m.symbol} from watchlist` : `Add ${m.symbol} to watchlist`}
                            onClick={() => onToggleWatchlist(m.symbol)}
                            className={`p-1 rounded transition-colors ${
                              isWatched ? 'text-[#f3dc8d]' : 'text-[#61708a] hover:text-[#b8c4d7]'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${isWatched ? 'fill-[#f3dc8d]' : ''}`} />
                          </button>
                        )}
                        <span className="w-7 h-7 rounded-full bg-[#1c2940] text-[#f3dc8d] font-bold grid place-items-center text-xs shrink-0">
                          {m.badge}
                        </span>
                        <div>
                          <div className="font-bold text-[#eef2f8]">{m.name}</div>
                          <div className="text-[10px] text-[#8190a8] font-mono">
                            {m.symbol} ·{' '}
                            <span className={isLivePair ? 'text-[#37d69a]' : 'text-[#8190a8]'}>
                              {isLivePair ? 'LIVE' : 'SIMULATED'}
                            </span>
                            {m.lastQuoteAt ? ` · ${formatDateTime(m.lastQuoteAt)}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#eef2f8]">
                      {formatAssetPrice(m.price)}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${
                        pos ? 'text-[#37d69a]' : 'text-[#ff667a]'
                      }`}
                    >
                      {formatPercent(m.change24hPct)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                      {formatAssetPrice(m.high24h)} / {formatAssetPrice(m.low24h)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#b8c4d7]">
                      {formatVolume(m.volume24h)} {m.baseAsset}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex justify-center">
                        <MiniSparkline
                          values={spark}
                          color={pos ? '#37d69a' : '#ff667a'}
                          width={90}
                          height={24}
                          fillArea={false}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">
                      {sig ? (
                        <span
                          className={
                            isBuySignal(sig.action)
                              ? 'text-[#37d69a] font-bold'
                              : isSellSignal(sig.action)
                                ? 'text-[#ff667a] font-bold'
                                : 'text-[#8190a8]'
                          }
                        >
                          {(sig.action ?? 'HOLD').replace('_', ' ')} ({sig.confidence}%)
                        </span>
                      ) : (
                        <span className="text-[#8190a8]">HOLD</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onTradeSymbol(m.symbol)}
                        className="gold-button px-3 py-1.5 rounded-lg text-[11px]"
                      >
                        Trade
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
