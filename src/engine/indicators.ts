import type { Candle, IndicatorSeries } from './types.ts';

export function computeSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function computeEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;

  let seed = 0;
  for (let i = 0; i < period; i++) {
    seed += values[i];
  }
  let prev = seed / period;
  result[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export function computeRSI(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period || period <= 0) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

export function computeMACD(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHistogram: (number | null)[];
} {
  const fast = computeEMA(values, fastPeriod);
  const slow = computeEMA(values, slowPeriod);
  const macdLine: (number | null)[] = values.map((_, idx) => {
    const f = fast[idx];
    const s = slow[idx];
    return f !== null && s !== null ? f - s : null;
  });

  const macdSignal: (number | null)[] = new Array(values.length).fill(null);
  const macdHistogram: (number | null)[] = new Array(values.length).fill(null);

  const validEntries: { idx: number; val: number }[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    const val = macdLine[i];
    if (val !== null) validEntries.push({ idx: i, val });
  }

  if (validEntries.length >= signalPeriod) {
    const signalValues = computeEMA(
      validEntries.map((v) => v.val),
      signalPeriod
    );
    for (let i = 0; i < validEntries.length; i++) {
      const sig = signalValues[i];
      const origIdx = validEntries[i].idx;
      if (sig !== null) {
        macdSignal[origIdx] = sig;
        macdHistogram[origIdx] = validEntries[i].val - sig;
      }
    }
  }

  return { macdLine, macdSignal, macdHistogram };
}

export function computeBollingerBands(
  values: number[],
  period = 20,
  stdDevMult = 2
): {
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
} {
  const bbMiddle = computeSMA(values, period);
  const bbUpper: (number | null)[] = new Array(values.length).fill(null);
  const bbLower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const mean = bbMiddle[i];
    if (mean === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      sumSq += d * d;
    }
    const std = Math.sqrt(sumSq / period);
    bbUpper[i] = mean + stdDevMult * std;
    bbLower[i] = mean - stdDevMult * std;
  }

  return { bbUpper, bbMiddle, bbLower };
}

export function computeATR(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period || period <= 0) return result;

  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose)
      );
      trs.push(tr);
    }
  }

  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += trs[i];
  }
  atr /= period;
  result[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result[i] = atr;
  }

  return result;
}

export function computeVWAP(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  let cumulativePv = 0;
  let cumulativeVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = Math.max(candles[i].volume, 1e-8);
    cumulativePv += typical * vol;
    cumulativeVol += vol;
    result[i] = cumulativePv / cumulativeVol;
  }
  return result;
}

export function computeAllIndicators(
  candles: Candle[],
  options?: {
    fastEma?: number;
    slowEma?: number;
    rsiPeriod?: number;
    bbStdDev?: number;
  }
): IndicatorSeries {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const fastEma = options?.fastEma ?? 20;
  const slowEma = options?.slowEma ?? 50;
  const rsiPeriod = options?.rsiPeriod ?? 14;
  const bbStdDev = options?.bbStdDev ?? 2;

  const sma20 = computeSMA(closes, 20);
  const ema20 = computeEMA(closes, fastEma);
  const ema50 = computeEMA(closes, slowEma);
  const rsi14 = computeRSI(closes, rsiPeriod);
  const { macdLine, macdSignal, macdHistogram } = computeMACD(closes, 12, 26, 9);
  const { bbUpper, bbMiddle, bbLower } = computeBollingerBands(closes, 20, bbStdDev);
  const atr14 = computeATR(candles, 14);
  const vwap = computeVWAP(candles);
  const volumeSma20 = computeSMA(volumes, 20);

  return {
    sma20,
    ema20,
    ema50,
    rsi14,
    macdLine,
    macdSignal,
    macdHistogram,
    bbUpper,
    bbMiddle,
    bbLower,
    atr14,
    vwap,
    volumeSma20,
  };
}
