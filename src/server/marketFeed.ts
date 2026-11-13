import type { PublicQuoteSnapshot } from '../engine/marketDataProvider.ts';
import type { Candle, MarketFeedStatus, Timeframe } from '../engine/types.ts';

export const SUPPORTED_CRYPTO_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'ADAUSDT',
] as const;

export const SUPPORTED_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const COINBASE_EXCHANGE_PAIRS: Record<string, string> = {
  BTCUSDT: 'BTC-USD',
  ETHUSDT: 'ETH-USD',
  SOLUSDT: 'SOL-USD',
  XRPUSDT: 'XRP-USD',
  AVAXUSDT: 'AVAX-USD',
  LINKUSDT: 'LINK-USD',
  ADAUSDT: 'ADA-USD',
};

const COINBASE_GRANULARITY: Record<Exclude<Timeframe, '4h'>, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
};

export interface LiveQuotesPayload {
  status: MarketFeedStatus;
  quotes: Record<string, PublicQuoteSnapshot>;
  unavailableSymbols: string[];
  provider: string;
  fetchedAt: number;
  error?: string;
}

export interface HistoricalCandlesPayload {
  ok: boolean;
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  count: number;
  dataSource: 'LIVE_PUBLIC' | 'UNAVAILABLE';
  providerName: string;
  fetchedAt: number;
  error?: string;
}

interface CacheEntry<T> {
  expiresAt: number;
  payload: T;
}

export interface MarketFeedServiceOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  quoteCacheTtlMs?: number;
  candleCacheTtlMs?: number;
}

export class MarketFeedService {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly quoteCacheTtlMs: number;
  private readonly candleCacheTtlMs: number;
  private readonly quoteCache = new Map<string, CacheEntry<LiveQuotesPayload>>();
  private readonly candleCache = new Map<string, CacheEntry<HistoricalCandlesPayload>>();

  constructor(options: MarketFeedServiceOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs =
      options.timeoutMs ??
      Math.max(1500, Math.min(15000, Number(process.env.MARKET_DATA_TIMEOUT_MS) || 4500));
    this.quoteCacheTtlMs = options.quoteCacheTtlMs ?? 4500;
    this.candleCacheTtlMs = options.candleCacheTtlMs ?? 15_000;
  }

  private async fetchJsonWithTimeout<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': '77-Trade-It-Market-Proxy/1.0',
        },
      });
      if (!res.ok) {
        throw new Error(`Upstream market provider responded with HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getLiveQuotes(symbolsInput: string[]): Promise<LiveQuotesPayload> {
    const validSet = new Set<string>(SUPPORTED_CRYPTO_SYMBOLS);
    const symbols = Array.from(
      new Set(symbolsInput.map((s) => s.trim().toUpperCase()).filter((s) => validSet.has(s)))
    );

    const cacheKey = symbols.slice().sort().join(',');
    const now = Date.now();
    const cached = this.quoteCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.payload;
    }

    const quotes: Record<string, PublicQuoteSnapshot> = {};
    const providersUsed = new Set<string>();
    const providerErrors: string[] = [];

    // 1. Primary: Binance Public Market Data Vision (batch 24hr ticker: spot, 24h open/high/low/volume/change%)
    try {
      const encodedSymbols = encodeURIComponent(JSON.stringify(symbols));
      const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodedSymbols}`;
      const rows = await this.fetchJsonWithTimeout<
        Array<{
          symbol?: string;
          lastPrice?: string;
          openPrice?: string;
          highPrice?: string;
          lowPrice?: string;
          volume?: string;
          priceChangePercent?: string;
          closeTime?: number;
        }>
      >(url);

      if (Array.isArray(rows)) {
        for (const row of rows) {
          const sym = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : '';
          if (!validSet.has(sym) || !symbols.includes(sym)) continue;
          const price = Number(row.lastPrice);
          const open24h = Number(row.openPrice);
          const high24h = Number(row.highPrice);
          const low24h = Number(row.lowPrice);
          const volume24h = Number(row.volume);
          const change24hPct = Number(row.priceChangePercent);
          if (!Number.isFinite(price) || price <= 0) continue;

          quotes[sym] = {
            symbol: sym,
            price,
            open24h: Number.isFinite(open24h) && open24h > 0 ? open24h : undefined,
            high24h: Number.isFinite(high24h) && high24h > 0 ? high24h : undefined,
            low24h: Number.isFinite(low24h) && low24h > 0 ? low24h : undefined,
            volume24h: Number.isFinite(volume24h) && volume24h >= 0 ? volume24h : undefined,
            change24hPct: Number.isFinite(change24hPct) ? change24hPct : undefined,
            dataSource: 'LIVE_PUBLIC',
            providerName: 'Binance Public Data API',
            timestamp:
              typeof row.closeTime === 'number' && Number.isFinite(row.closeTime) && row.closeTime > 0
                ? row.closeTime
                : now,
          };
          providersUsed.add('Binance Public Data API');
        }
      }
    } catch (err) {
      providerErrors.push(err instanceof Error ? err.message : 'Primary Binance feed error');
    }

    // 2. Fallback: Coinbase Exchange Public Stats API for any missing symbols
    const missingAfterPrimary = symbols.filter((s) => !quotes[s]);
    if (missingAfterPrimary.length > 0) {
      await Promise.all(
        missingAfterPrimary.map(async (symbol) => {
          const pair = COINBASE_EXCHANGE_PAIRS[symbol];
          if (!pair) return;
          try {
            const stats = await this.fetchJsonWithTimeout<{
              open?: string;
              high?: string;
              low?: string;
              last?: string;
              volume?: string;
            }>(`https://api.exchange.coinbase.com/products/${pair}/stats`);
            const price = Number(stats.last);
            const open24h = Number(stats.open);
            const high24h = Number(stats.high);
            const low24h = Number(stats.low);
            const volume24h = Number(stats.volume);
            if (!Number.isFinite(price) || price <= 0) return;

            const change24hPct =
              Number.isFinite(open24h) && open24h > 0
                ? Number((((price - open24h) / open24h) * 100).toFixed(2))
                : undefined;

            quotes[symbol] = {
              symbol,
              price,
              open24h: Number.isFinite(open24h) && open24h > 0 ? open24h : undefined,
              high24h: Number.isFinite(high24h) && high24h > 0 ? high24h : undefined,
              low24h: Number.isFinite(low24h) && low24h > 0 ? low24h : undefined,
              volume24h: Number.isFinite(volume24h) && volume24h >= 0 ? volume24h : undefined,
              change24hPct,
              dataSource: 'LIVE_PUBLIC',
              providerName: 'Coinbase Exchange Public API',
              timestamp: now,
            };
            providersUsed.add('Coinbase Exchange Public API');
          } catch (err) {
            providerErrors.push(
              `${symbol}: ${err instanceof Error ? err.message : 'Coinbase fallback unavailable'}`
            );
          }
        })
      );
    }

    const unavailableSymbols = symbols.filter((s) => !quotes[s]);
    const quoteCount = Object.keys(quotes).length;
    const status: MarketFeedStatus =
      quoteCount === 0 ? 'UNAVAILABLE' : unavailableSymbols.length > 0 ? 'PARTIAL' : 'LIVE';

    const payload: LiveQuotesPayload = {
      status,
      quotes,
      unavailableSymbols,
      provider:
        providersUsed.size > 0
          ? Array.from(providersUsed).join(' + ')
          : 'Public Crypto Feed (Unavailable)',
      fetchedAt: now,
      error:
        status === 'UNAVAILABLE'
          ? providerErrors[0] ?? 'All upstream public market data providers failed.'
          : status === 'PARTIAL'
            ? `Missing live quotes for: ${unavailableSymbols.join(', ')}`
            : undefined,
    };

    if (quoteCount > 0) {
      this.quoteCache.set(cacheKey, { expiresAt: now + this.quoteCacheTtlMs, payload });
    }
    return payload;
  }

  async getHistoricalCandles(
    symbolInput: string,
    timeframe: Timeframe,
    limitInput = 120
  ): Promise<HistoricalCandlesPayload> {
    const symbol = symbolInput.trim().toUpperCase();
    const limit = Math.max(20, Math.min(200, Math.floor(limitInput)));
    const cacheKey = `${symbol}:${timeframe}:${limit}`;
    const now = Date.now();

    const cached = this.candleCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.payload;
    }

    const errors: string[] = [];

    // 1. Primary: Binance Public Klines
    try {
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`;
      const rows = await this.fetchJsonWithTimeout<Array<Array<number | string>>>(url);
      if (Array.isArray(rows) && rows.length > 0) {
        const candles: Candle[] = [];
        for (const r of rows) {
          if (!Array.isArray(r) || r.length < 6) continue;
          const timestamp = Number(r[0]);
          const open = Number(r[1]);
          const high = Number(r[2]);
          const low = Number(r[3]);
          const close = Number(r[4]);
          const volume = Number(r[5]);
          if (
            Number.isFinite(timestamp) &&
            Number.isFinite(open) &&
            Number.isFinite(high) &&
            Number.isFinite(low) &&
            Number.isFinite(close) &&
            close > 0 &&
            Number.isFinite(volume) &&
            volume >= 0
          ) {
            candles.push({ timestamp, open, high, low, close, volume });
          }
        }
        if (candles.length > 0) {
          candles.sort((a, b) => a.timestamp - b.timestamp);
          const payload: HistoricalCandlesPayload = {
            ok: true,
            symbol,
            timeframe,
            candles,
            count: candles.length,
            dataSource: 'LIVE_PUBLIC',
            providerName: 'Binance Public OHLCV',
            fetchedAt: now,
          };
          this.candleCache.set(cacheKey, { expiresAt: now + this.candleCacheTtlMs, payload });
          return payload;
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Primary OHLCV provider unavailable');
    }

    // 2. Fallback: Coinbase Exchange Public Candles
    const pair = COINBASE_EXCHANGE_PAIRS[symbol];
    if (pair) {
      try {
        const granularity =
          timeframe === '4h' ? COINBASE_GRANULARITY['1h'] : COINBASE_GRANULARITY[timeframe];
        const rows = await this.fetchJsonWithTimeout<Array<[number, number, number, number, number, number]>>(
          `https://api.exchange.coinbase.com/products/${pair}/candles?granularity=${granularity}`
        );

        if (Array.isArray(rows) && rows.length > 0) {
          const baseBars: Candle[] = rows
            .filter((r) => Array.isArray(r) && r.length >= 6)
            .map((r) => ({
              timestamp: Number(r[0]) * 1000,
              low: Number(r[1]),
              high: Number(r[2]),
              open: Number(r[3]),
              close: Number(r[4]),
              volume: Number(r[5]),
            }))
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
            .sort((a, b) => a.timestamp - b.timestamp);

          let finalCandles = baseBars;
          if (timeframe === '4h' && baseBars.length >= 4) {
            const grouped = new Map<number, Candle[]>();
            const fourHoursMs = 4 * 3_600_000;
            for (const b of baseBars) {
              const bucket = Math.floor(b.timestamp / fourHoursMs) * fourHoursMs;
              const arr = grouped.get(bucket) ?? [];
              arr.push(b);
              grouped.set(bucket, arr);
            }
            finalCandles = Array.from(grouped.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([ts, group]) => ({
                timestamp: ts,
                open: group[0].open,
                high: Math.max(...group.map((g) => g.high)),
                low: Math.min(...group.map((g) => g.low)),
                close: group[group.length - 1].close,
                volume: Number(group.reduce((s, g) => s + g.volume, 0).toFixed(4)),
              }));
          }

          finalCandles = finalCandles.slice(-limit);
          if (finalCandles.length > 0) {
            const payload: HistoricalCandlesPayload = {
              ok: true,
              symbol,
              timeframe,
              candles: finalCandles,
              count: finalCandles.length,
              dataSource: 'LIVE_PUBLIC',
              providerName: 'Coinbase Exchange OHLCV',
              fetchedAt: now,
            };
            this.candleCache.set(cacheKey, { expiresAt: now + this.candleCacheTtlMs, payload });
            return payload;
          }
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Coinbase OHLCV fallback unavailable');
      }
    }

    return {
      ok: false,
      symbol,
      timeframe,
      candles: [],
      count: 0,
      dataSource: 'UNAVAILABLE',
      providerName: 'Public OHLCV Proxy (Unavailable)',
      fetchedAt: now,
      error: errors[0] ?? `No genuine OHLCV candles available for ${symbol} (${timeframe}).`,
    };
  }
}
