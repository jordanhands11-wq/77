import type { Candle, MarketDataMode, MarketFeedStatus, Timeframe } from './types.ts';

export interface PublicQuoteSnapshot {
  symbol: string;
  price: number;
  open24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  change24hPct?: number;
  dataSource: 'SIMULATED' | 'LIVE_PUBLIC';
  providerName: string;
  timestamp: number;
}

export interface LiveQuotesFetchResult {
  status: MarketFeedStatus;
  quotes: Record<string, PublicQuoteSnapshot>;
  unavailableSymbols: string[];
  providerName: string;
  fetchedAt: number;
  error?: string;
}

export interface HistoricalCandlesFetchResult {
  ok: boolean;
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  dataSource: 'LIVE_PUBLIC' | 'UNAVAILABLE';
  providerName: string;
  fetchedAt: number;
  error?: string;
}

export interface MarketDataProvider {
  id: MarketDataMode;
  name: string;
  fetchQuotes(symbols: string[]): Promise<Record<string, PublicQuoteSnapshot>>;
  fetchQuotesDetailed(symbols: string[]): Promise<LiveQuotesFetchResult>;
  fetchHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    limit?: number
  ): Promise<HistoricalCandlesFetchResult>;
}

// Read-only public market data client routed strictly through our server proxy
// (zero trading credentials, zero order execution, zero fake price fabrication on errors)
export const livePublicCryptoProvider: MarketDataProvider = {
  id: 'LIVE_PUBLIC_READONLY',
  name: 'Public Crypto Market Feed (Binance Vision / Coinbase Exchange)',

  async fetchQuotesDetailed(symbols: string[]): Promise<LiveQuotesFetchResult> {
    const now = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5500);
      const query = encodeURIComponent(symbols.join(','));
      const proxyRes = await fetch(`/api/markets/live-quotes?symbols=${query}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const payload = (await proxyRes.json().catch(() => ({}))) as {
        status?: MarketFeedStatus;
        quotes?: Record<string, PublicQuoteSnapshot>;
        unavailableSymbols?: string[];
        provider?: string;
        fetchedAt?: number;
        error?: string;
      };

      const quotes = payload.quotes ?? {};
      const quoteCount = Object.keys(quotes).length;

      if (!proxyRes.ok || quoteCount === 0) {
        return {
          status: 'UNAVAILABLE',
          quotes: {},
          unavailableSymbols: payload.unavailableSymbols ?? symbols,
          providerName: payload.provider ?? 'Public Market Proxy',
          fetchedAt: payload.fetchedAt ?? now,
          error:
            payload.error ??
            `Live market feed returned HTTP ${proxyRes.status}. Simulated prices are NOT substituted as live.`,
        };
      }

      const unavailable =
        payload.unavailableSymbols ?? symbols.filter((s) => !quotes[s]);

      return {
        status: payload.status ?? (unavailable.length > 0 ? 'PARTIAL' : 'LIVE'),
        quotes,
        unavailableSymbols: unavailable,
        providerName: payload.provider ?? 'Binance / Coinbase Public Feed',
        fetchedAt: payload.fetchedAt ?? now,
        error: payload.error,
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        status: 'UNAVAILABLE',
        quotes: {},
        unavailableSymbols: symbols,
        providerName: 'Public Market Proxy',
        fetchedAt: now,
        error: isAbort
          ? 'Live market quote request timed out.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach live market quote proxy.',
      };
    }
  },

  async fetchQuotes(symbols: string[]): Promise<Record<string, PublicQuoteSnapshot>> {
    const detailed = await this.fetchQuotesDetailed(symbols);
    return detailed.quotes;
  },

  async fetchHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 120
  ): Promise<HistoricalCandlesFetchResult> {
    const now = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);
      const url = `/api/markets/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      const payload = (await res.json().catch(() => ({}))) as {
        candles?: Candle[];
        providerName?: string;
        fetchedAt?: number;
        error?: string;
      };

      if (!res.ok || !Array.isArray(payload.candles) || payload.candles.length === 0) {
        return {
          ok: false,
          symbol,
          timeframe,
          candles: [],
          dataSource: 'UNAVAILABLE',
          providerName: payload.providerName ?? 'Public Market Proxy',
          fetchedAt: payload.fetchedAt ?? now,
          error:
            payload.error ??
            `Historical ${timeframe} candles unavailable for ${symbol} (HTTP ${res.status}).`,
        };
      }

      return {
        ok: true,
        symbol,
        timeframe,
        candles: payload.candles,
        dataSource: 'LIVE_PUBLIC',
        providerName: payload.providerName ?? 'Binance / Coinbase Public OHLCV',
        fetchedAt: payload.fetchedAt ?? now,
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        symbol,
        timeframe,
        candles: [],
        dataSource: 'UNAVAILABLE',
        providerName: 'Public Market Proxy',
        fetchedAt: now,
        error: isAbort
          ? `Historical ${timeframe} candle fetch timed out.`
          : err instanceof Error
            ? err.message
            : 'Unable to fetch historical candles.',
      };
    }
  },
};
