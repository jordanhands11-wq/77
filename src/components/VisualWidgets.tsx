import React from 'react';

interface MiniSparklineProps {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  fillArea?: boolean;
}

export const MiniSparkline: React.FC<MiniSparklineProps> = ({
  values,
  color = '#d4af37',
  width = 110,
  height = 36,
  fillArea = true,
}) => {
  if (values.length < 2) {
    return <div style={{ width, height }} className="opacity-20 border-b border-[#1b2940]" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const padY = 3;

  const points = values.map((v, idx) => {
    const x = (idx / (values.length - 1)) * width;
    const y = padY + (1 - (v - min) / span) * (height - padY * 2);
    return { x, y };
  });

  const lineD = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaD = `${lineD} L${width} ${height} L0 ${height} Z`;
  const gradId = `spark-${color.replace('#', '')}-${width}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fillArea && <path d={areaD} fill={`url(#${gradId})`} />}
      <path d={lineD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

interface RadialGaugeProps {
  valuePct: number;
  label: string;
  sublabel?: string;
  size?: number;
  color?: string;
  trackColor?: string;
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  valuePct,
  label,
  sublabel,
  size = 104,
  color = '#37d69a',
  trackColor = '#1b2940',
}) => {
  const clamped = Math.max(0, Math.min(100, valuePct));
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
        <span className="text-base font-bold font-mono tabular-nums text-[#eef2f8] leading-tight">
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] text-[#8190a8] leading-tight mt-0.5">{sublabel}</span>
        )}
      </div>
    </div>
  );
};

export const IntelligenceNeuralIcon: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
    <defs>
      <linearGradient id="neuralGold" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fff0b8" />
        <stop offset="50%" stopColor="#d4af37" />
        <stop offset="100%" stopColor="#8a6514" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="29" stroke="url(#neuralGold)" strokeOpacity="0.35" strokeDasharray="3 3" />
    <path
      d="M23 44C17.5 44 14 39.5 14 34C14 30.5 15.8 27.6 18.4 26C18.1 24.8 18 23.4 18.4 21.8C19.4 17.5 23.5 15 27.8 15.6C29.4 14.5 31.4 14 33.4 14.3C38.4 15 42.2 18.8 43 23.7C46.5 25.1 49 28.5 49 32.5C49 37.8 44.8 42.3 39.6 42.5C37.8 45.2 34.4 46.8 30.8 46.2C28.4 45.8 26.2 44.6 24.8 43.2"
      stroke="url(#neuralGold)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M32 15V46M23 23L32 28L41 22M20 33L32 36L44 32M25 41L32 36L38 41"
      stroke="url(#neuralGold)"
      strokeOpacity="0.7"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <circle cx="32" cy="28" r="2.2" fill="#f3dc8d" />
    <circle cx="23" cy="23" r="1.8" fill="#d4af37" />
    <circle cx="41" cy="22" r="1.8" fill="#d4af37" />
    <circle cx="20" cy="33" r="1.8" fill="#d4af37" />
    <circle cx="44" cy="32" r="1.8" fill="#d4af37" />
    <circle cx="32" cy="36" r="2" fill="#f3dc8d" />
  </svg>
);

interface EquityAreaChartProps {
  points: { label: string; value: number }[];
  height?: number;
  color?: string;
}

export const EquityAreaChart: React.FC<EquityAreaChartProps> = ({
  points,
  height = 190,
  color = '#d4af37',
}) => {
  const width = 760;
  if (points.length === 0) {
    return (
      <div className="h-[190px] flex items-center justify-center text-xs text-[#8190a8] border border-[#1b2940] rounded-lg bg-[#070c17]">
        No equity history recorded yet.
      </div>
    );
  }

  const safePoints = points.length === 1 ? [points[0], points[0]] : points;
  const vals = safePoints.map((p) => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const span = Math.max(10, maxVal - minVal);
  const padTop = 18;
  const padBottom = 26;
  const padLeft = 10;
  const padRight = 70;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const coords = safePoints.map((p, i) => {
    const x = padLeft + (i / (safePoints.length - 1)) * plotW;
    const y = padTop + (1 - (p.value - minVal) / span) * plotH;
    return { x, y, label: p.label, value: p.value };
  });

  const lineD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const fillD = `${lineD} L${coords[coords.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L${coords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block">
      <defs>
        <linearGradient id="eqGoldFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t, idx) => {
        const y = padTop + t * plotH;
        const val = maxVal - t * span;
        return (
          <g key={idx}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#1b2940" strokeDasharray="3 4" />
            <text x={width - padRight + 8} y={y + 3.5} fill="#8190a8" fontSize="10" fontFamily="JetBrains Mono">
              ${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </text>
          </g>
        );
      })}
      <path d={fillD} fill="url(#eqGoldFade)" />
      <path d={lineD} fill="none" stroke={color} strokeWidth="2.4" />
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="3.5"
        fill="#f3dc8d"
      />
      {[0, Math.floor((coords.length - 1) / 2), coords.length - 1].map((idx, i) => (
        <text
          key={i}
          x={coords[idx].x}
          y={height - 6}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          fill="#687891"
          fontSize="9.5"
          fontFamily="JetBrains Mono"
        >
          {coords[idx].label}
        </text>
      ))}
    </svg>
  );
};
