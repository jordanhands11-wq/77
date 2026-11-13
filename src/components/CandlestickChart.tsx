import React, { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import { computeAllIndicators } from '../engine/indicators.ts';
import { TIMEFRAMES, TIMEFRAME_MS } from '../engine/marketData.ts';
import type {
  Candle,
  ClosedTrade,
  MarketInstrument,
  OrderRecord,
  Position,
  Timeframe,
} from '../engine/types.ts';
import { formatAssetPrice, formatDateTime, formatPercent, formatVolume } from '../utils/format.ts';

interface CandlestickChartProps {
  market: MarketInstrument;
  candles: Candle[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  openPositions: Position[];
  orderHistory?: OrderRecord[];
  closedTrades?: ClosedTrade[];
  chartType?: 'CANDLE' | 'LINE';
  onChartTypeChange?: (mode: 'CANDLE' | 'LINE') => void;
  candleDataSource?: 'SIMULATED' | 'LIVE_PUBLIC';
  isLoadingCandles?: boolean;
  candleError?: string | null;
  lastUpdatedAt?: number | null;
}

type SubPaneMode = 'OFF' | 'RSI' | 'MACD';

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  market,
  candles,
  timeframe,
  onTimeframeChange,
  openPositions,
  orderHistory = [],
  closedTrades = [],
  chartType: controlledChartType,
  onChartTypeChange,
  candleDataSource = 'SIMULATED',
  isLoadingCandles = false,
  candleError = null,
  lastUpdatedAt = null,
}) => {
  const [localChartType, setLocalChartType] = useState<'CANDLE' | 'LINE'>('CANDLE');
  const chartType = controlledChartType ?? localChartType;
  const setChartType = (mode: 'CANDLE' | 'LINE') => {
    setLocalChartType(mode);
    onChartTypeChange?.(mode);
  };

  const [visibleCount, setVisibleCount] = useState<number>(64);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [showEma20, setShowEma20] = useState<boolean>(true);
  const [showEma50, setShowEma50] = useState<boolean>(true);
  const [showSma20, setShowSma20] = useState<boolean>(false);
  const [showBb, setShowBb] = useState<boolean>(false);
  const [showVwap, setShowVwap] = useState<boolean>(false);
  const [subPane, setSubPane] = useState<SubPaneMode>('RSI');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const indicators = useMemo(() => computeAllIndicators(candles), [candles]);

  const total = candles.length;
  const clampedOffset = Math.max(0, Math.min(panOffset, Math.max(0, total - 20)));
  const endIndex = Math.max(20, total - clampedOffset);
  const startIndex = Math.max(0, endIndex - visibleCount);
  const viewCandles = candles.slice(startIndex, endIndex);

  const symbolPositions = openPositions.filter((p) => p.symbol === market.symbol);
  const symbolFilledOrders = orderHistory.filter(
    (o) => o.symbol === market.symbol && o.status === 'FILLED' && o.executedPrice !== undefined
  );
  const symbolClosedTrades = closedTrades.filter((t) => t.symbol === market.symbol);

  const width = 920;
  const priceHeight = subPane === 'OFF' ? 300 : 235;
  const volHeight = 52;
  const subHeight = subPane === 'OFF' ? 0 : 76;
  const totalHeight = priceHeight + volHeight + subHeight + (subPane === 'OFF' ? 24 : 34);

  const padLeft = 12;
  const padRight = 76;
  const plotWidth = width - padLeft - padRight;

  const { minPrice, maxPrice, maxVol } = useMemo(() => {
    if (viewCandles.length === 0) {
      return { minPrice: 0, maxPrice: 1, maxVol: 1 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    let mVol = 0;

    for (let i = 0; i < viewCandles.length; i++) {
      const c = viewCandles[i];
      const absIdx = startIndex + i;
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > mVol) mVol = c.volume;

      if (showEma20 && indicators.ema20[absIdx] !== null) {
        lo = Math.min(lo, indicators.ema20[absIdx]!);
        hi = Math.max(hi, indicators.ema20[absIdx]!);
      }
      if (showEma50 && indicators.ema50[absIdx] !== null) {
        lo = Math.min(lo, indicators.ema50[absIdx]!);
        hi = Math.max(hi, indicators.ema50[absIdx]!);
      }
      if (showSma20 && indicators.sma20[absIdx] !== null) {
        lo = Math.min(lo, indicators.sma20[absIdx]!);
        hi = Math.max(hi, indicators.sma20[absIdx]!);
      }
      if (showBb && indicators.bbLower[absIdx] !== null && indicators.bbUpper[absIdx] !== null) {
        lo = Math.min(lo, indicators.bbLower[absIdx]!);
        hi = Math.max(hi, indicators.bbUpper[absIdx]!);
      }
      if (showVwap && indicators.vwap[absIdx] !== null) {
        lo = Math.min(lo, indicators.vwap[absIdx]!);
        hi = Math.max(hi, indicators.vwap[absIdx]!);
      }
    }

    const span = Math.max(hi - lo, hi * 0.004);
    return {
      minPrice: lo - span * 0.08,
      maxPrice: hi + span * 0.08,
      maxVol: Math.max(1, mVol),
    };
  }, [viewCandles, startIndex, indicators, showEma20, showEma50, showSma20, showBb, showVwap]);

  const priceToY = (price: number) => {
    const ratio = (price - minPrice) / Math.max(1e-9, maxPrice - minPrice);
    return 14 + (1 - ratio) * (priceHeight - 24);
  };

  const stepX = plotWidth / Math.max(1, viewCandles.length);
  const candleWidth = Math.max(2.5, Math.min(12, stepX * 0.64));

  const buildPath = (series: (number | null)[]) => {
    let d = '';
    let penDown = false;
    for (let i = 0; i < viewCandles.length; i++) {
      const val = series[startIndex + i];
      if (val === null || val === undefined) {
        penDown = false;
        continue;
      }
      const x = padLeft + (i + 0.5) * stepX;
      const y = priceToY(val);
      d += `${penDown ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      penDown = true;
    }
    return d;
  };

  const lineClosePath = useMemo(() => {
    if (viewCandles.length === 0) return '';
    return viewCandles
      .map((c, i) => {
        const x = padLeft + (i + 0.5) * stepX;
        const y = priceToY(c.close);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [viewCandles, stepX, minPrice, maxPrice]);

  const lineAreaPath = useMemo(() => {
    if (viewCandles.length === 0) return '';
    const firstX = padLeft + 0.5 * stepX;
    const lastX = padLeft + (viewCandles.length - 0.5) * stepX;
    return `${lineClosePath} L${lastX.toFixed(1)} ${priceHeight} L${firstX.toFixed(1)} ${priceHeight} Z`;
  }, [lineClosePath, viewCandles.length, stepX, priceHeight]);

  // Map execution buy/sell markers and closed trade exit markers to visible candle index
  const chartMarkers = useMemo(() => {
    const markers: {
      key: string;
      x: number;
      y: number;
      kind: 'BUY' | 'SELL' | 'EXIT';
      label: string;
    }[] = [];

    if (viewCandles.length === 0) return markers;
    const tfWindow = TIMEFRAME_MS[timeframe];

    const findCandleIdx = (ts: number): number => {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < viewCandles.length; i++) {
        const dist = Math.abs(viewCandles[i].timestamp - ts);
        if (dist <= tfWindow * 1.5 && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    for (const ord of symbolFilledOrders.slice(0, 20)) {
      const idx = findCandleIdx(ord.updatedAt);
      if (idx === -1) continue;
      const bar = viewCandles[idx];
      const x = padLeft + (idx + 0.5) * stepX;
      const y = ord.side === 'BUY' ? priceToY(bar.low) + 12 : priceToY(bar.high) - 12;
      markers.push({
        key: `ord-${ord.id}`,
        x,
        y: Math.max(12, Math.min(priceHeight - 10, y)),
        kind: ord.side,
        label: `${ord.side} ${formatAssetPrice(ord.executedPrice ?? ord.requestedPrice)}`,
      });
    }

    for (const tr of symbolClosedTrades.slice(0, 12)) {
      const idx = findCandleIdx(tr.closedAt);
      if (idx === -1) continue;
      const x = padLeft + (idx + 0.5) * stepX;
      const y = priceToY(tr.exitPrice);
      markers.push({
        key: `exit-${tr.id}`,
        x,
        y: Math.max(12, Math.min(priceHeight - 10, y)),
        kind: 'EXIT',
        label: `Exit ${formatAssetPrice(tr.exitPrice)}`,
      });
    }

    return markers;
  }, [viewCandles, symbolFilledOrders, symbolClosedTrades, timeframe, stepX, minPrice, maxPrice, priceHeight]);

  const hoveredBar =
    hoverIdx !== null && viewCandles[hoverIdx] ? viewCandles[hoverIdx] : viewCandles[viewCandles.length - 1];
  const hoveredAbsIdx =
    hoverIdx !== null && viewCandles[hoverIdx] ? startIndex + hoverIdx : candles.length - 1;
  const hoveredVolSma = indicators.volumeSma20[hoveredAbsIdx];
  const hoveredVolRatio =
    hoveredBar && hoveredVolSma && hoveredVolSma > 0 ? hoveredBar.volume / hoveredVolSma : null;

  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minPrice + (maxPrice - minPrice) * (1 - t));

  const macdBounds = useMemo(() => {
    if (subPane !== 'MACD') return { min: -1, max: 1 };
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < viewCandles.length; i++) {
      const idx = startIndex + i;
      const m = indicators.macdLine[idx];
      const s = indicators.macdSignal[idx];
      const h = indicators.macdHistogram[idx];
      if (m !== null) {
        lo = Math.min(lo, m);
        hi = Math.max(hi, m);
      }
      if (s !== null) {
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      if (h !== null) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    const pad = Math.max(1e-6, (hi - lo) * 0.15);
    return { min: lo - pad, max: hi + pad };
  }, [subPane, viewCandles.length, startIndex, indicators]);

  const updateCrosshairAtClientX = (clientX: number, rect: DOMRect) => {
    if (rect.width <= 0) return;
    const relX = ((clientX - rect.left) / rect.width) * width;
    const idx = Math.floor((relX - padLeft) / stepX);
    if (idx >= 0 && idx < viewCandles.length) {
      setHoverIdx(idx);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    updateCrosshairAtClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const handleTouchCrosshair = (e: React.TouchEvent<SVGSVGElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    updateCrosshairAtClientX(touch.clientX, e.currentTarget.getBoundingClientRect());
  };

  return (
    <div className="terminal-card p-4 flex flex-col gap-3">
      {/* Chart Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
        <div className="flex items-baseline gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#8190a8] flex flex-wrap items-center gap-1.5">
              <span>{market.name}</span>
              <span aria-hidden="true">·</span>
              <span>{market.symbol}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  market.dataSource === 'LIVE_PUBLIC' && candleDataSource === 'LIVE_PUBLIC'
                    ? 'text-[#37d69a] font-semibold'
                    : market.dataSource === 'LIVE_PUBLIC'
                      ? 'text-[#f2bd58] font-semibold'
                      : 'text-[#8190a8]'
                }
              >
                {candleDataSource === 'LIVE_PUBLIC'
                  ? `Live Public OHLCV (${market.providerName ?? 'Public Feed'})`
                  : market.dataSource === 'LIVE_PUBLIC'
                    ? 'Live Spot · Simulated Historical Bars'
                    : 'Simulated OHLCV Feed'}
              </span>
              {lastUpdatedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono normal-case text-[#8190a8]">
                    {formatDateTime(lastUpdatedAt)}
                  </span>
                </>
              )}
              {isLoadingCandles && (
                <span className="inline-flex items-center gap-1 text-[#f3dc8d] normal-case ml-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading {timeframe} bars
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2.5 mt-0.5">
              <span className="text-2xl font-bold font-mono tabular-nums text-[#eef2f8]">
                {formatAssetPrice(market.price)}
              </span>
              <span
                className={`text-xs font-mono font-semibold tabular-nums ${
                  market.change24hPct >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                }`}
              >
                {formatPercent(market.change24hPct)}
              </span>
            </div>
          </div>
          <div className="hidden xl:flex items-center gap-4 text-xs text-[#8190a8] pl-4 border-l border-[#1b2940] tabular-nums">
            <span>
              24h High <strong className="text-[#eef2f8] font-mono ml-1">{formatAssetPrice(market.high24h)}</strong>
            </span>
            <span>
              24h Low <strong className="text-[#eef2f8] font-mono ml-1">{formatAssetPrice(market.low24h)}</strong>
            </span>
            <span>
              24h Vol <strong className="text-[#eef2f8] font-mono ml-1">{formatVolume(market.volume24h)}</strong>
            </span>
          </div>
        </div>

        {/* Chart Mode + Timeframe + Zoom Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5">
            {(['CANDLE', 'LINE'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChartType(mode)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  chartType === mode
                    ? 'bg-[#2a2414] text-[#f3dc8d] border border-[#54451e]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                {mode === 'CANDLE' ? 'Candles' : 'Line'}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  onTimeframeChange(tf);
                  setPanOffset(0);
                }}
                className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-[#2a2414] text-[#f3dc8d] border border-[#54451e]'
                    : 'text-[#8190a8] hover:text-[#eef2f8]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-[#070c17] border border-[#1b2940] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setVisibleCount((v) => Math.max(24, v - 14))}
              title="Zoom In"
              className="p-1.5 text-[#8190a8] hover:text-[#f3dc8d] transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setVisibleCount((v) => Math.min(candles.length, v + 14))}
              title="Zoom Out"
              className="p-1.5 text-[#8190a8] hover:text-[#f3dc8d] transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setVisibleCount(64);
                setPanOffset(0);
              }}
              title="Reset Chart View"
              className="p-1.5 text-[#8190a8] hover:text-[#f3dc8d] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Candle Data Warning */}
      {candleError && (
        <div className="flex items-center gap-2 text-[11px] text-[#f2bd58] bg-[#2a2110]/70 border border-[#5c4a22] rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{candleError} — displaying fallback simulated bars until historical OHLCV recovers.</span>
        </div>
      )}

      {/* Indicator Overlay Bar + Live OHLC Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[#8190a8] mr-1">Overlays:</span>
          <button
            type="button"
            onClick={() => setShowEma20((v) => !v)}
            className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
              showEma20
                ? 'border-[#d4af37]/60 bg-[#211c0e] text-[#f3dc8d]'
                : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            EMA 20
          </button>
          <button
            type="button"
            onClick={() => setShowEma50((v) => !v)}
            className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
              showEma50
                ? 'border-[#6ea8fe]/60 bg-[#0e1d36] text-[#9ec5fe]'
                : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            EMA 50
          </button>
          <button
            type="button"
            onClick={() => setShowSma20((v) => !v)}
            className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
              showSma20
                ? 'border-[#a78bfa]/60 bg-[#1c1635] text-[#c4b5fd]'
                : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            SMA 20
          </button>
          <button
            type="button"
            onClick={() => setShowBb((v) => !v)}
            className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
              showBb
                ? 'border-[#f2bd58]/60 bg-[#2a2110] text-[#f2bd58]'
                : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            Bollinger
          </button>
          <button
            type="button"
            onClick={() => setShowVwap((v) => !v)}
            className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
              showVwap
                ? 'border-[#37d69a]/60 bg-[#0f2922] text-[#37d69a]'
                : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            VWAP
          </button>
          <span className="text-[#8190a8] ml-2 mr-1">Sub-pane:</span>
          {(['RSI', 'MACD', 'OFF'] as SubPaneMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSubPane(mode)}
              className={`px-2 py-0.5 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
                subPane === mode
                  ? 'border-[#d4af37]/60 bg-[#211c0e] text-[#f3dc8d]'
                  : 'border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {hoveredBar && (
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[#8190a8]">
            <span>{formatDateTime(hoveredBar.timestamp)}</span>
            <span>
              O <strong className="text-[#eef2f8]">{formatAssetPrice(hoveredBar.open)}</strong>
            </span>
            <span>
              H <strong className="text-[#37d69a]">{formatAssetPrice(hoveredBar.high)}</strong>
            </span>
            <span>
              L <strong className="text-[#ff667a]">{formatAssetPrice(hoveredBar.low)}</strong>
            </span>
            <span>
              C <strong className="text-[#eef2f8]">{formatAssetPrice(hoveredBar.close)}</strong>
            </span>
            <span>
              V <strong className="text-[#b8c4d7]">{formatVolume(hoveredBar.volume)}</strong>
              {hoveredVolRatio !== null ? ` (${hoveredVolRatio.toFixed(1)}×)` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Candlestick / Line + Volume + Oscillator SVG Viewport */}
      <div className="relative bg-[#070c17] border border-[#1b2940] rounded-lg overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${totalHeight}`}
          className="w-full h-auto block select-none cursor-crosshair touch-pan-y"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          onTouchStart={handleTouchCrosshair}
          onTouchMove={handleTouchCrosshair}
          onTouchEnd={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="lineChartGoldFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Price Grid & Right Price Axis */}
          {priceTicks.map((tickPrice, i) => {
            const y = priceToY(tickPrice);
            return (
              <g key={i}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="#1b2940"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                />
                <text
                  x={width - padRight + 8}
                  y={y + 3.5}
                  fill="#8190a8"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {tickPrice >= 100 ? tickPrice.toFixed(1) : tickPrice.toFixed(4)}
                </text>
              </g>
            );
          })}

          {/* Open Position Entry / SL / TP Price Lines */}
          {symbolPositions.map((pos) => {
            const entryY = priceToY(pos.entryPrice);
            const showEntry = entryY >= 10 && entryY <= priceHeight - 6;
            const slY = pos.stopLoss ? priceToY(pos.stopLoss) : null;
            const tpY = pos.takeProfit ? priceToY(pos.takeProfit) : null;

            return (
              <g key={pos.id}>
                {showEntry && (
                  <>
                    <line
                      x1={padLeft}
                      x2={width - padRight}
                      y1={entryY}
                      y2={entryY}
                      stroke="#f3dc8d"
                      strokeWidth="1.2"
                      strokeDasharray="5 3"
                    />
                    <text x={padLeft + 6} y={entryY - 4} fill="#f3dc8d" fontSize="9.5" fontFamily="JetBrains Mono">
                      {pos.side} ENTRY {formatAssetPrice(pos.entryPrice)}
                    </text>
                  </>
                )}
                {slY !== null && slY >= 10 && slY <= priceHeight - 6 && (
                  <>
                    <line
                      x1={padLeft}
                      x2={width - padRight}
                      y1={slY}
                      y2={slY}
                      stroke="#ff667a"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <text x={padLeft + 6} y={slY - 4} fill="#ff667a" fontSize="9.5" fontFamily="JetBrains Mono">
                      SL {formatAssetPrice(pos.stopLoss!)}
                    </text>
                  </>
                )}
                {tpY !== null && tpY >= 10 && tpY <= priceHeight - 6 && (
                  <>
                    <line
                      x1={padLeft}
                      x2={width - padRight}
                      y1={tpY}
                      y2={tpY}
                      stroke="#37d69a"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <text x={padLeft + 6} y={tpY - 4} fill="#37d69a" fontSize="9.5" fontFamily="JetBrains Mono">
                      TP {formatAssetPrice(pos.takeProfit!)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Bollinger Bands */}
          {showBb && (
            <>
              <path d={buildPath(indicators.bbUpper)} fill="none" stroke="#f2bd58" strokeOpacity="0.65" strokeWidth="1.2" />
              <path d={buildPath(indicators.bbMiddle)} fill="none" stroke="#f2bd58" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1" />
              <path d={buildPath(indicators.bbLower)} fill="none" stroke="#f2bd58" strokeOpacity="0.65" strokeWidth="1.2" />
            </>
          )}

          {/* VWAP */}
          {showVwap && (
            <path d={buildPath(indicators.vwap)} fill="none" stroke="#37d69a" strokeOpacity="0.8" strokeWidth="1.4" strokeDasharray="4 2" />
          )}

          {/* Candles or Line Mode */}
          {chartType === 'CANDLE' ? (
            viewCandles.map((c, i) => {
              const cx = padLeft + (i + 0.5) * stepX;
              const isBull = c.close >= c.open;
              const color = isBull ? '#37d69a' : '#ff667a';
              const openY = priceToY(c.open);
              const closeY = priceToY(c.close);
              const highY = priceToY(c.high);
              const lowY = priceToY(c.low);
              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

              return (
                <g key={c.timestamp}>
                  <line x1={cx} x2={cx} y1={highY} y2={lowY} stroke={color} strokeWidth="1.2" />
                  <rect
                    x={cx - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    rx="0.8"
                  />
                </g>
              );
            })
          ) : (
            <>
              <path d={lineAreaPath} fill="url(#lineChartGoldFade)" />
              <path d={lineClosePath} fill="none" stroke="#f3dc8d" strokeWidth="2.2" />
            </>
          )}

          {/* Moving Average Overlays */}
          {showEma20 && (
            <path d={buildPath(indicators.ema20)} fill="none" stroke="#d4af37" strokeWidth="1.7" />
          )}
          {showEma50 && (
            <path d={buildPath(indicators.ema50)} fill="none" stroke="#6ea8fe" strokeWidth="1.6" />
          )}
          {showSma20 && (
            <path d={buildPath(indicators.sma20)} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="4 2" />
          )}

          {/* Buy / Sell & Exit Markers */}
          {chartMarkers.map((m) => {
            if (m.kind === 'BUY') {
              return (
                <g key={m.key}>
                  <polygon
                    points={`${m.x},${m.y - 5} ${m.x - 4.5},${m.y + 4} ${m.x + 4.5},${m.y + 4}`}
                    fill="#37d69a"
                  />
                </g>
              );
            }
            if (m.kind === 'SELL') {
              return (
                <g key={m.key}>
                  <polygon
                    points={`${m.x},${m.y + 5} ${m.x - 4.5},${m.y - 4} ${m.x + 4.5},${m.y - 4}`}
                    fill="#ff667a"
                  />
                </g>
              );
            }
            return (
              <circle
                key={m.key}
                cx={m.x}
                cy={m.y}
                r="3.5"
                fill="#070c17"
                stroke="#f3dc8d"
                strokeWidth="1.6"
              />
            );
          })}

          {/* Current Market Price Tag */}
          {viewCandles.length > 0 && (
            <g>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={priceToY(market.price)}
                y2={priceToY(market.price)}
                stroke="#d4af37"
                strokeOpacity="0.45"
                strokeWidth="1"
              />
              <rect
                x={width - padRight + 2}
                y={priceToY(market.price) - 9}
                width={70}
                height={18}
                rx="3"
                fill="#d4af37"
              />
              <text
                x={width - padRight + 7}
                y={priceToY(market.price) + 3.5}
                fill="#15120a"
                fontSize="10"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {market.price >= 100 ? market.price.toFixed(1) : market.price.toFixed(4)}
              </text>
            </g>
          )}

          {/* Volume Histogram */}
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={priceHeight}
            y2={priceHeight}
            stroke="#1b2940"
            strokeWidth="1"
          />
          <text x={padLeft + 4} y={priceHeight + 12} fill="#61708a" fontSize="9.5" fontFamily="JetBrains Mono">
            VOL / SMA20
          </text>
          {viewCandles.map((c, i) => {
            const cx = padLeft + (i + 0.5) * stepX;
            const barH = (c.volume / maxVol) * (volHeight - 12);
            const isBull = c.close >= c.open;
            return (
              <rect
                key={`v-${c.timestamp}`}
                x={cx - candleWidth / 2}
                y={priceHeight + volHeight - barH}
                width={candleWidth}
                height={Math.max(1, barH)}
                fill={isBull ? '#37d69a' : '#ff667a'}
                fillOpacity="0.38"
              />
            );
          })}

          {/* RSI or MACD Sub-pane */}
          {subPane === 'RSI' && (
            <g>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={priceHeight + volHeight + 6}
                y2={priceHeight + volHeight + 6}
                stroke="#1b2940"
              />
              <text
                x={padLeft + 4}
                y={priceHeight + volHeight + 19}
                fill="#8190a8"
                fontSize="9.5"
                fontFamily="JetBrains Mono"
              >
                RSI(14):{' '}
                {indicators.rsi14[hoveredAbsIdx] !== null
                  ? indicators.rsi14[hoveredAbsIdx]!.toFixed(1)
                  : '--'}
              </text>
              {[70, 30].map((lvl) => {
                const y = priceHeight + volHeight + 12 + ((100 - lvl) / 100) * (subHeight - 14);
                return (
                  <g key={lvl}>
                    <line
                      x1={padLeft}
                      x2={width - padRight}
                      y1={y}
                      y2={y}
                      stroke="#1b2940"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={width - padRight + 8}
                      y={y + 3}
                      fill="#61708a"
                      fontSize="9"
                      fontFamily="JetBrains Mono"
                    >
                      {lvl}
                    </text>
                  </g>
                );
              })}
              <path
                d={(() => {
                  let d = '';
                  let started = false;
                  for (let i = 0; i < viewCandles.length; i++) {
                    const val = indicators.rsi14[startIndex + i];
                    if (val === null) {
                      started = false;
                      continue;
                    }
                    const x = padLeft + (i + 0.5) * stepX;
                    const y = priceHeight + volHeight + 12 + ((100 - val) / 100) * (subHeight - 14);
                    d += `${started ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
                    started = true;
                  }
                  return d;
                })()}
                fill="none"
                stroke="#f3dc8d"
                strokeWidth="1.5"
              />
            </g>
          )}

          {subPane === 'MACD' && (
            <g>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={priceHeight + volHeight + 6}
                y2={priceHeight + volHeight + 6}
                stroke="#1b2940"
              />
              <text
                x={padLeft + 4}
                y={priceHeight + volHeight + 19}
                fill="#8190a8"
                fontSize="9.5"
                fontFamily="JetBrains Mono"
              >
                MACD(12,26,9)
              </text>
              {(() => {
                const mapMacdY = (v: number) => {
                  const ratio = (v - macdBounds.min) / Math.max(1e-9, macdBounds.max - macdBounds.min);
                  return priceHeight + volHeight + 14 + (1 - ratio) * (subHeight - 18);
                };
                const zeroY = mapMacdY(0);
                let lineD = '';
                let sigD = '';
                let lineStart = false;
                let sigStart = false;

                const histBars = viewCandles.map((c, i) => {
                  const idx = startIndex + i;
                  const x = padLeft + (i + 0.5) * stepX;
                  const m = indicators.macdLine[idx];
                  const s = indicators.macdSignal[idx];
                  const h = indicators.macdHistogram[idx];
                  if (m !== null) {
                    lineD += `${lineStart ? 'L' : 'M'}${x.toFixed(1)} ${mapMacdY(m).toFixed(1)} `;
                    lineStart = true;
                  }
                  if (s !== null) {
                    sigD += `${sigStart ? 'L' : 'M'}${x.toFixed(1)} ${mapMacdY(s).toFixed(1)} `;
                    sigStart = true;
                  }
                  if (h === null) return null;
                  const hY = mapMacdY(h);
                  return (
                    <rect
                      key={`mh-${c.timestamp}`}
                      x={x - candleWidth / 2}
                      y={Math.min(zeroY, hY)}
                      width={candleWidth}
                      height={Math.max(1, Math.abs(hY - zeroY))}
                      fill={h >= 0 ? '#37d69a' : '#ff667a'}
                      fillOpacity="0.45"
                    />
                  );
                });

                return (
                  <>
                    <line x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} stroke="#1b2940" strokeDasharray="2 3" />
                    {histBars}
                    <path d={lineD} fill="none" stroke="#6ea8fe" strokeWidth="1.3" />
                    <path d={sigD} fill="none" stroke="#f2bd58" strokeWidth="1.2" />
                  </>
                );
              })()}
            </g>
          )}

          {/* Interactive Crosshair */}
          {hoverIdx !== null && viewCandles[hoverIdx] && (
            <g>
              <line
                x1={padLeft + (hoverIdx + 0.5) * stepX}
                x2={padLeft + (hoverIdx + 0.5) * stepX}
                y1={10}
                y2={totalHeight - 16}
                stroke="#8190a8"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
              />
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={priceToY(viewCandles[hoverIdx].close)}
                y2={priceToY(viewCandles[hoverIdx].close)}
                stroke="#8190a8"
                strokeOpacity="0.35"
                strokeDasharray="3 3"
              />
            </g>
          )}

          {/* Bottom Time Axis */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
            const cIdx = Math.min(
              viewCandles.length - 1,
              Math.floor(frac * Math.max(0, viewCandles.length - 1))
            );
            const c = viewCandles[cIdx];
            if (!c) return null;
            const x = padLeft + (cIdx + 0.5) * stepX;
            return (
              <text
                key={`t-${idx}`}
                x={x}
                y={totalHeight - 4}
                textAnchor={idx === 0 ? 'start' : idx === 4 ? 'end' : 'middle'}
                fill="#687891"
                fontSize="9.5"
                fontFamily="JetBrains Mono"
              >
                {formatDateTime(c.timestamp)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Pan Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8190a8]">
        <span>
          Displaying {viewCandles.length} of {candles.length} bars · Markers: ▲ Buy · ▼ Sell · ○ Exit
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={startIndex === 0}
            onClick={() => setPanOffset((p) => Math.min(Math.max(0, total - visibleCount), p + 12))}
            className="px-2 py-1 rounded border border-[#1b2940] text-[#b8c4d7] hover:border-[#d4af37]/50 disabled:opacity-35"
          >
            ← Earlier
          </button>
          <button
            type="button"
            disabled={panOffset === 0}
            onClick={() => setPanOffset((p) => Math.max(0, p - 12))}
            className="px-2 py-1 rounded border border-[#1b2940] text-[#b8c4d7] hover:border-[#d4af37]/50 disabled:opacity-35"
          >
            Latest →
          </button>
        </div>
      </div>
    </div>
  );
};
