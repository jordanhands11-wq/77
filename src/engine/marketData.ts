import type { Candle, MarketInstrument, Timeframe } from './types.ts';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

interface MarketSeedSpec {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  badge: string;
  basePrice: number;
  changePctBias: number;
  volatility: number;
  tickSize: number;
  minQty: number;
  baseVolume: number;
}

export const INITIAL_MARKET_SPECS: MarketSeedSpec[] = [
  {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    name: 'Bitcoin',
    badge: '₿',
    basePrice: 67482.3,
    changePctBias: 0.0241,
    volatility: 0.0042,
    tickSize: 0.01,
    minQty: 0.0001,
    baseVolume: 28450,
  },
  {
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    name: 'Ethereum',
    badge: 'Ξ',
    basePrice: 3521.8,
    changePctBias: 0.0132,
    volatility: 0.0052,
    tickSize: 0.01,
    minQty: 0.001,
    baseVolume: 184200,
  },
  {
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    name: 'Solana',
    badge: '◎',
    basePrice: 148.62,
    changePctBias: -0.0084,
    volatility: 0.0078,
    tickSize: 0.01,
    minQty: 0.01,
    baseVolume: 2150000,
  },
  {
    symbol: 'BNBUSDT',
    baseAsset: 'BNB',
    quoteAsset: 'USDT',
    name: 'BNB',
    badge: '◆',
    basePrice: 594.4,
    changePctBias: 0.0114,
    volatility: 0.0048,
    tickSize: 0.01,
    minQty: 0.01,
    baseVolume: 410000,
  },
  {
    symbol: 'XRPUSDT',
    baseAsset: 'XRP',
    quoteAsset: 'USDT',
    name: 'XRP',
    badge: '✕',
    basePrice: 0.5482,
    changePctBias: -0.0045,
    volatility: 0.0068,
    tickSize: 0.0001,
    minQty: 1,
    baseVolume: 96000000,
  },
  {
    symbol: 'AVAXUSDT',
    baseAsset: 'AVAX',
    quoteAsset: 'USDT',
    name: 'Avalanche',
    badge: '▲',
    basePrice: 34.86,
    changePctBias: 0.0285,
    volatility: 0.0085,
    tickSize: 0.01,
    minQty: 0.1,
    baseVolume: 4850000,
  },
  {
    symbol: 'LINKUSDT',
    baseAsset: 'LINK',
    quoteAsset: 'USDT',
    name: 'Chainlink',
    badge: '⬡',
    basePrice: 17.42,
    changePctBias: 0.0176,
    volatility: 0.0074,
    tickSize: 0.01,
    minQty: 0.1,
    baseVolume: 7120000,
  },
  {
    symbol: 'ADAUSDT',
    baseAsset: 'ADA',
    quoteAsset: 'USDT',
    name: 'Cardano',
    badge: '₳',
    basePrice: 0.4615,
    changePctBias: -0.0118,
    volatility: 0.0071,
    tickSize: 0.0001,
    minQty: 1,
    baseVolume: 64200000,
  },
];

// Deterministic PRNG (Mulberry32) so initial history and tests are reproducible
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roundToTick(value: number, tickSize: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(tickSize)));
  const rounded = Math.round(value / tickSize) * tickSize;
  return Number(rounded.toFixed(decimals));
}

function generateTimeframeCandles(
  spec: MarketSeedSpec,
  timeframe: Timeframe,
  barCount = 120,
  anchorTime = Date.UTC(2026, 10, 13, 14, 0, 0)
): Candle[] {
  const tfMs = TIMEFRAME_MS[timeframe];
  const tfScale = Math.sqrt(tfMs / TIMEFRAME_MS['1h']);
  const vol = spec.volatility * Math.max(0.35, Math.min(2.2, tfScale));

  let hash = 0;
  for (let i = 0; i < spec.symbol.length; i++) {
    hash = (hash * 31 + spec.symbol.charCodeAt(i)) | 0;
  }
  hash += timeframe.charCodeAt(0) * 101;
  const rng = createSeededRng(hash);

  // Build normalized random walk then rescale so last close equals spec.basePrice
  const rawCloses: number[] = [];
  let cursor = 100;
  const drift = spec.changePctBias / 40;
  for (let i = 0; i < barCount; i++) {
    const wave = Math.sin(i * 0.22 + hash) * vol * 0.45;
    const shock = (rng() - 0.485) * vol * 2.1 + drift * 0.35;
    cursor = Math.max(10, cursor * (1 + wave + shock));
    rawCloses.push(cursor);
  }

  const finalRaw = rawCloses[rawCloses.length - 1];
  const scaleFactor = spec.basePrice / finalRaw;

  const candles: Candle[] = [];
  let prevClose = roundToTick(rawCloses[0] * scaleFactor, spec.tickSize);

  for (let i = 0; i < barCount; i++) {
    const timestamp = anchorTime - (barCount - 1 - i) * tfMs;
    const close = roundToTick(rawCloses[i] * scaleFactor, spec.tickSize);
    const open = i === 0 ? roundToTick(close * (1 - (rng() - 0.5) * vol), spec.tickSize) : prevClose;
    const bodyMax = Math.max(open, close);
    const bodyMin = Math.min(open, close);
    const upperWick = bodyMax * (rng() * vol * 0.85);
    const lowerWick = bodyMin * (rng() * vol * 0.85);
    const high = roundToTick(bodyMax + upperWick, spec.tickSize);
    const low = roundToTick(Math.max(spec.tickSize, bodyMin - lowerWick), spec.tickSize);
    const rangePct = Math.abs(close - open) / Math.max(open, spec.tickSize);
    const volume = Number(
      ((spec.baseVolume / 24) * (0.55 + rng() * 0.9 + (rangePct / Math.max(vol, 1e-4)) * 0.4)).toFixed(2)
    );

    candles.push({
      timestamp,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
    });
    prevClose = close;
  }

  return candles;
}

export function createInitialMarketsAndCandles(anchorTime = Date.UTC(2026, 10, 13, 14, 0, 0)): {
  markets: Record<string, MarketInstrument>;
  candles: Record<string, Record<Timeframe, Candle[]>>;
} {
  const markets: Record<string, MarketInstrument> = {};
  const candles: Record<string, Record<Timeframe, Candle[]>> = {};

  for (const spec of INITIAL_MARKET_SPECS) {
    const tfMap = {} as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      tfMap[tf] = generateTimeframeCandles(spec, tf, 120, anchorTime);
    }
    candles[spec.symbol] = tfMap;

    const hourly = tfMap['1h'];
    const lookback24 = hourly.slice(-24);
    const open24h = lookback24[0]?.open ?? spec.basePrice;
    const high24h = Math.max(...lookback24.map((c) => c.high));
    const low24h = Math.min(...lookback24.map((c) => c.low));
    const volume24h = Number(lookback24.reduce((acc, c) => acc + c.volume, 0).toFixed(2));
    const price = hourly[hourly.length - 1]?.close ?? spec.basePrice;
    const change24hPct = Number((((price - open24h) / open24h) * 100).toFixed(2));

    markets[spec.symbol] = {
      symbol: spec.symbol,
      baseAsset: spec.baseAsset,
      quoteAsset: spec.quoteAsset,
      name: spec.name,
      badge: spec.badge,
      price,
      open24h,
      high24h,
      low24h,
      volume24h,
      change24hPct,
      volatility: spec.volatility,
      tickSize: spec.tickSize,
      minQty: spec.minQty,
      dataSource: 'SIMULATED',
    };
  }

  return { markets, candles };
}

export function stepMarketData(
  markets: Record<string, MarketInstrument>,
  candles: Record<string, Record<Timeframe, Candle[]>>,
  tick: number,
  seedSalt?: number
): {
  markets: Record<string, MarketInstrument>;
  candles: Record<string, Record<Timeframe, Candle[]>>;
} {
  const nextMarkets: Record<string, MarketInstrument> = {};
  const nextCandles: Record<string, Record<Timeframe, Candle[]>> = {};

  for (const [symbol, market] of Object.entries(markets)) {
    let hash = tick * 7919 + (seedSalt ?? 17);
    for (let i = 0; i < symbol.length; i++) {
      hash = (hash * 31 + symbol.charCodeAt(i)) | 0;
    }
    const rng = createSeededRng(hash);

    // Mean-reverting + momentum simulated step
    const shock = (rng() - 0.492) * market.volatility * 1.8;
    const meanRev = ((market.open24h - market.price) / market.open24h) * 0.03;
    const rawNewPrice = Math.max(market.tickSize, market.price * (1 + shock + meanRev));
    const newPrice = roundToTick(rawNewPrice, market.tickSize);

    const symbolCandles = {} as Record<Timeframe, Candle[]>;
    for (const tf of TIMEFRAMES) {
      const existing = candles[symbol]?.[tf] ?? [];
      if (existing.length === 0) {
        symbolCandles[tf] = [];
        continue;
      }
      const last = existing[existing.length - 1];
      const nextTs = last.timestamp + TIMEFRAME_MS[tf];
      const open = last.close;
      const wickScale = market.volatility * (0.4 + rng() * 0.8);
      const high = roundToTick(Math.max(open, newPrice) * (1 + wickScale * 0.45), market.tickSize);
      const low = roundToTick(
        Math.max(market.tickSize, Math.min(open, newPrice) * (1 - wickScale * 0.45)),
        market.tickSize
      );
      const volMultiplier = 0.6 + rng() * 1.1;
      const newBar: Candle = {
        timestamp: nextTs,
        open,
        high,
        low,
        close: newPrice,
        volume: Number((last.volume * 0.4 + (market.volume24h / 24) * 0.6 * volMultiplier).toFixed(2)),
      };
      symbolCandles[tf] = [...existing.slice(-149), newBar];
    }

    nextCandles[symbol] = symbolCandles;

    const hourly = symbolCandles['1h'];
    const lookback24 = hourly.slice(-24);
    const open24h = lookback24[0]?.open ?? market.open24h;
    const high24h = Math.max(...lookback24.map((c) => c.high));
    const low24h = Math.min(...lookback24.map((c) => c.low));
    const volume24h = Number(lookback24.reduce((acc, c) => acc + c.volume, 0).toFixed(2));
    const change24hPct = Number((((newPrice - open24h) / open24h) * 100).toFixed(2));

    nextMarkets[symbol] = {
      ...market,
      price: newPrice,
      open24h,
      high24h,
      low24h,
      volume24h,
      change24hPct,
    };
  }

  return { markets: nextMarkets, candles: nextCandles };
}
