import React, { useMemo } from 'react';
import { CheckCircle2, TrendingUp, Activity, BarChart3 } from 'lucide-react';
import { computeAllIndicators } from '../../engine/indicators.ts';
import { TIMEFRAMES } from '../../engine/marketData.ts';
import { isBuySignal, isSellSignal } from '../../engine/strategies.ts';
import type { Timeframe, TradingEngineState } from '../../engine/types.ts';
import { formatAssetPrice, formatPercent, formatVolume } from '../../utils/format.ts';
import { IntelligenceNeuralIcon, RadialGauge } from '../VisualWidgets.tsx';

interface AnalysisViewProps {
  state: TradingEngineState;
  onSelectSymbol: (symbol: string) => void;
  onSelectTimeframe: (tf: Timeframe) => void;
  onTradeSymbol: (symbol: string) => void;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  state,
  onSelectSymbol,
  onSelectTimeframe,
  onTradeSymbol,
}) => {
  const market = state.markets[state.selectedSymbol] ?? Object.values(state.markets)[0];
  const candles = state.candles[market.symbol]?.[state.selectedTimeframe] ?? [];
  const indicators = useMemo(() => computeAllIndicators(candles), [candles]);

  const lastIdx = candles.length - 1;
  const lastBar = candles[lastIdx];
  const ema20 = indicators.ema20[lastIdx];
  const ema50 = indicators.ema50[lastIdx];
  const rsi14 = indicators.rsi14[lastIdx];
  const macdLine = indicators.macdLine[lastIdx];
  const macdSignal = indicators.macdSignal[lastIdx];
  const macdHist = indicators.macdHistogram[lastIdx];
  const atr14 = indicators.atr14[lastIdx];
  const vwap = indicators.vwap[lastIdx];
  const bbUpper = indicators.bbUpper[lastIdx];
  const bbLower = indicators.bbLower[lastIdx];

  const avgVol20 = indicators.volumeSma20[lastIdx] ?? (lastBar?.volume || 1);

  const trendBullish = ema20 !== null && ema50 !== null && ema20 > ema50;
  const macdBullish = macdHist !== null && macdHist > 0;
  const volRatio = lastBar && avgVol20 > 0 ? lastBar.volume / avgVol20 : 1;
  const atrPct = atr14 && lastBar ? (atr14 / lastBar.close) * 100 : 0;

  const primarySignal =
    state.signals.find(
      (s) => s.symbol === state.selectedSymbol && s.strategyId === 'rhino_confluence'
    ) ?? state.signals.find((s) => s.symbol === state.selectedSymbol);

  const symbolSignals = state.signals.filter((s) => s.symbol === state.selectedSymbol);

  return (
    <div className="space-y-6">
      {/* Selector Bar */}
      <div className="terminal-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IntelligenceNeuralIcon size={44} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#d4af37] font-bold">
              77 Intelligence · Quantitative Market Analysis
            </div>
            <h2 className="text-base font-bold text-[#eef2f8]">
              {market.name} ({market.symbol}) — {formatAssetPrice(market.price)}{' '}
              <span className={market.change24hPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'}>
                {formatPercent(market.change24hPct)}
              </span>
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Analysis instrument"
            value={state.selectedSymbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 text-xs font-mono text-[#f3dc8d] focus:outline-none focus:border-[#d4af37]"
          >
            {Object.values(state.markets).map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol}
              </option>
            ))}
          </select>

          <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onSelectTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-colors ${
                  state.selectedTimeframe === tf
                    ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#54451e]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 77 Intelligence Regime Checklist + Trade Opportunity Confidence Gauge */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 terminal-card p-5 border-[#54451e]/70 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#f3dc8d]">Market Structure Diagnostics</h3>
            <span className="text-xs text-[#8190a8]">{state.selectedTimeframe} Indicator Series</span>
          </div>

          <div className="divide-y divide-[#1b2940]">
            {[
              {
                label: 'Trend Regime (EMA 20 / 50)',
                value: trendBullish ? 'Bullish Alignment' : 'Bearish Alignment',
                ok: trendBullish,
              },
              {
                label: 'Momentum (RSI 14)',
                value:
                  rsi14 === null
                    ? 'Warming up'
                    : rsi14 > 65
                      ? `Overbought (${rsi14.toFixed(1)})`
                      : rsi14 < 35
                        ? `Oversold (${rsi14.toFixed(1)})`
                        : `Balanced (${rsi14.toFixed(1)})`,
                ok: rsi14 !== null && rsi14 >= 48 && rsi14 <= 72,
              },
              {
                label: 'MACD (12, 26, 9) Histogram',
                value: macdBullish ? 'Positive Expansion' : 'Negative / Contracting',
                ok: macdBullish,
              },
              {
                label: 'Volatility (ATR 14)',
                value: atrPct > 0.9 ? `Elevated (${atrPct.toFixed(2)}% / bar)` : `Moderate (${atrPct.toFixed(2)}% / bar)`,
                ok: atrPct <= 1.2,
              },
              {
                label: 'Volume Flow vs 20-Bar Mean',
                value: `${volRatio.toFixed(2)}× average (${formatVolume(lastBar?.volume ?? 0)})`,
                ok: volRatio >= 0.95,
              },
            ].map((row) => (
              <div key={row.label} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-[#b8c4d7]">
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${row.ok ? 'text-[#37d69a]' : 'text-[#f2bd58]'}`}
                  />
                  {row.label}
                </span>
                <span className="font-mono tabular-nums font-semibold text-[#eef2f8]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 terminal-card p-5 border-[#54451e]/70 flex flex-col justify-between gap-4">
          {primarySignal && (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#d4af37] font-bold">
                    {(primarySignal.category ?? 'NEUTRAL').replace('_', ' ')} · {primarySignal.strategyName}
                  </div>
                  <div className="text-xl font-bold text-[#eef2f8] mt-1">
                    {market.symbol} —{' '}
                    <span
                      className={
                        isBuySignal(primarySignal.action)
                          ? 'text-[#37d69a]'
                          : isSellSignal(primarySignal.action)
                            ? 'text-[#ff667a]'
                            : 'text-[#f2bd58]'
                      }
                    >
                      {(primarySignal.action ?? 'HOLD').replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-[#8190a8] mt-1 tabular-nums">
                    Ref: {formatAssetPrice(primarySignal.price)} · SL:{' '}
                    {formatAssetPrice(primarySignal.suggestedStopLoss)} · TP:{' '}
                    {formatAssetPrice(primarySignal.suggestedTakeProfit)}
                  </div>
                </div>
                <RadialGauge
                  valuePct={primarySignal.confidence}
                  label={`${primarySignal.confidence}%`}
                  sublabel={primarySignal.strengthLabel}
                  size={92}
                  color={
                    isBuySignal(primarySignal.action)
                      ? '#37d69a'
                      : isSellSignal(primarySignal.action)
                        ? '#ff667a'
                        : '#d4af37'
                  }
                />
              </div>

              <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 space-y-1">
                {(primarySignal.reasons ?? []).map((r, i) => (
                  <div key={i} className="text-xs text-[#b8c4d7]">
                    • {r}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onTradeSymbol(market.symbol)}
                className="gold-button w-full py-2.5 rounded-lg text-xs"
              >
                Open {market.baseAsset} in Trading Terminal
              </button>
            </>
          )}
        </div>
      </section>

      {/* Technical Indicator Readings Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="terminal-card p-4">
          <div className="flex items-center justify-between text-[11px] text-[#8190a8] uppercase">
            <span>RSI (14)</span>
            <Activity className="w-3.5 h-3.5 text-[#d4af37]" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#eef2f8] mt-2">
            {rsi14 !== null ? rsi14.toFixed(2) : '--'}
          </div>
          <div className="text-xs text-[#8190a8] mt-1">
            {rsi14 === null
              ? 'Insufficient bars'
              : rsi14 > 70
                ? 'Overbought zone (>70)'
                : rsi14 < 30
                  ? 'Oversold zone (<30)'
                  : 'Neutral momentum band (30–70)'}
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="flex items-center justify-between text-[11px] text-[#8190a8] uppercase">
            <span>MACD (12, 26, 9)</span>
            <TrendingUp className="w-3.5 h-3.5 text-[#d4af37]" />
          </div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-2 ${
              (macdHist ?? 0) >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
            }`}
          >
            {macdHist !== null ? `${macdHist >= 0 ? '+' : ''}${macdHist.toFixed(3)}` : '--'}
          </div>
          <div className="text-xs text-[#8190a8] mt-1 font-mono tabular-nums">
            Line: {macdLine?.toFixed(2) ?? '--'} · Sig: {macdSignal?.toFixed(2) ?? '--'}
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="flex items-center justify-between text-[11px] text-[#8190a8] uppercase">
            <span>Moving Averages</span>
            <BarChart3 className="w-3.5 h-3.5 text-[#d4af37]" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-[#eef2f8] mt-2">
            EMA20: {ema20 !== null ? formatAssetPrice(ema20) : '--'}
          </div>
          <div className="text-xs text-[#8190a8] mt-1 font-mono tabular-nums">
            EMA50: {ema50 !== null ? formatAssetPrice(ema50) : '--'} · VWAP:{' '}
            {vwap !== null ? formatAssetPrice(vwap) : '--'}
          </div>
        </div>

        <div className="terminal-card p-4">
          <div className="flex items-center justify-between text-[11px] text-[#8190a8] uppercase">
            <span>Bollinger &amp; Volatility</span>
            <Activity className="w-3.5 h-3.5 text-[#d4af37]" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-[#eef2f8] mt-2">
            ATR: {atr14 !== null ? formatAssetPrice(atr14) : '--'}
          </div>
          <div className="text-xs text-[#8190a8] mt-1 font-mono tabular-nums">
            Bands: {bbLower ? formatAssetPrice(bbLower) : '--'} –{' '}
            {bbUpper ? formatAssetPrice(bbUpper) : '--'}
          </div>
        </div>
      </section>

      {/* Strategy Signal Matrix for Selected Symbol */}
      <section className="terminal-card p-4">
        <h3 className="text-sm font-bold text-[#eef2f8] mb-3">
          Strategy Signals on {market.symbol}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {symbolSignals.map((sig) => (
            <div key={sig.strategyId} className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#eef2f8]">{sig.strategyName}</span>
                <span
                  className={`text-xs font-mono font-bold ${
                    isBuySignal(sig.action)
                      ? 'text-[#37d69a]'
                      : isSellSignal(sig.action)
                        ? 'text-[#ff667a]'
                        : 'text-[#f2bd58]'
                  }`}
                >
                  {(sig.action ?? 'HOLD').replace('_', ' ')} ({sig.confidence}%)
                </span>
              </div>
              <div className="text-[11px] text-[#8190a8] mt-1">
                {(sig.category ?? 'NEUTRAL').replace('_', ' ')} · {sig.timeframe} · SL {formatAssetPrice(sig.suggestedStopLoss)} · TP{' '}
                {formatAssetPrice(sig.suggestedTakeProfit)}
              </div>
              <div className="text-xs text-[#b8c4d7] mt-2">{sig.reasons?.[0]}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
