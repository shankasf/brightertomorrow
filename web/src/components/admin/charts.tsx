'use client';
/**
 * Brand chart kit — pure-SVG primitives tuned to the BT palette.
 * Gold #E1B878, wine #66202A, teal #75ACC0, peach #FFBC7D, ink #192735.
 *
 * Designed for the admin dashboard: stable, readable, no chart-lib dependency.
 */
import { motion } from 'framer-motion';
import { useId, useMemo, useState } from 'react';

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

/**
 * Build a Catmull-Rom → Bezier smoothed path for a series of [x,y] points.
 * Tension 0.5 gives the soft editorial curve we want without overshoot.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const t = 0.5;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * t * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * t * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * t * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * t * 2;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

type Series = { name: string; color: string; values: number[] };

/**
 * Layered area chart with smoothed strokes, gradient fills, day-axis labels,
 * and a hover-to-inspect crosshair. The chart is responsive (viewBox) and
 * animates on mount.
 */
export function MultiAreaChart({
  series,
  days,
  height = 280,
}: {
  series: Series[];
  days: string[];
  height?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const padding = { top: 18, right: 16, bottom: 28, left: 36 };
  const w = 720;
  const h = height;
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;

  const n = days.length || 1;
  const stepX = innerW / Math.max(n - 1, 1);

  const yMax = Math.max(
    1,
    ...series.flatMap((s) => s.values),
  );
  // round up to a nice number
  const niceMax = useMemo(() => {
    const pow = Math.pow(10, Math.floor(Math.log10(yMax)));
    const head = Math.ceil(yMax / pow);
    const nice = (head <= 1 ? 1 : head <= 2 ? 2 : head <= 5 ? 5 : 10) * pow;
    return Math.max(nice, 4);
  }, [yMax]);

  const yTicks = 4;
  const tickStep = niceMax / yTicks;
  const yScale = (v: number) => padding.top + innerH - (v / niceMax) * innerH;
  const xScale = (i: number) => padding.left + i * stepX;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const i = Math.round((px - padding.left) / stepX);
          if (i >= 0 && i < n) setHoverIdx(i);
          else setHoverIdx(null);
        }}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${uid}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="60%" stopColor={s.color} stopOpacity="0.08" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <pattern id={`${uid}-grid`} width={stepX} height={innerH / yTicks} patternUnits="userSpaceOnUse">
            <path
              d={`M${stepX} 0 L0 0 0 ${innerH / yTicks}`}
              fill="none"
              stroke="rgba(25,39,53,0.05)"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* Grid */}
        <rect
          x={padding.left}
          y={padding.top}
          width={innerW}
          height={innerH}
          fill={`url(#${uid}-grid)`}
        />

        {/* Y axis ticks */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = Math.round(tickStep * (yTicks - i));
          const y = padding.top + (i * innerH) / yTicks;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                x2={w - padding.right}
                y1={y}
                y2={y}
                stroke="rgba(25,39,53,0.06)"
                strokeWidth="1"
                strokeDasharray={i === yTicks ? '0' : '2 3'}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#858585"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {fmt(v)}
              </text>
            </g>
          );
        })}

        {/* Series — areas first, then strokes on top */}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
          const linePath = smoothPath(pts);
          const areaPath =
            linePath +
            ` L${xScale(pts.length - 1)},${padding.top + innerH}` +
            ` L${xScale(0)},${padding.top + innerH} Z`;
          return (
            <g key={si}>
              <motion.path
                d={areaPath}
                fill={`url(#${uid}-fill-${si})`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.1 + si * 0.08 }}
              />
              <motion.path
                d={linePath}
                fill="none"
                stroke={s.color}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.1, delay: 0.05 + si * 0.08, ease: [0.22, 1, 0.36, 1] }}
                style={{ filter: `drop-shadow(0 2px 4px ${s.color}55)` }}
              />
            </g>
          );
        })}

        {/* X labels — show 5 evenly spaced */}
        {days.map((d, i) => {
          const step = Math.max(1, Math.floor(n / 5));
          if (i % step !== 0 && i !== n - 1) return null;
          const dt = new Date(d);
          const label = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <text
              key={i}
              x={xScale(i)}
              y={h - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#858585"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {label}
            </text>
          );
        })}

        {/* Hover crosshair + dots */}
        {hoverIdx !== null && (
          <g>
            <line
              x1={xScale(hoverIdx)}
              x2={xScale(hoverIdx)}
              y1={padding.top}
              y2={padding.top + innerH}
              stroke="rgba(25,39,53,0.18)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((s, si) => (
              <g key={si}>
                <circle
                  cx={xScale(hoverIdx)}
                  cy={yScale(s.values[hoverIdx] ?? 0)}
                  r="5"
                  fill="white"
                  stroke={s.color}
                  strokeWidth="2.25"
                />
              </g>
            ))}
          </g>
        )}
      </svg>

      {/* Tooltip — positioned in CSS so it tracks pointer-snapped index */}
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-1 max-w-[220px] rounded-xl border border-[#E5E5E5] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_30px_rgba(25,39,53,0.12)] backdrop-blur"
          style={{
            left: `${Math.max(15, Math.min(85, (xScale(hoverIdx) / w) * 100))}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            {new Date(days[hoverIdx]).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-ink/80">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="font-mono tabular-nums font-semibold text-ink">
                {s.values[hoverIdx] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Animated donut. Renders one or more arcs with a center label.
 */
export function Donut({
  segments,
  size = 180,
  thickness = 16,
  centerLabel,
  centerSub,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerSub?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - thickness;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <defs>
          {segments.map((s, i) => (
            <linearGradient key={i} id={`${uid}-arc-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.95" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.7" />
            </linearGradient>
          ))}
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(25,39,53,0.06)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const offset = (-acc / total) * circumference;
          acc += s.value;
          return (
            <motion.circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={`url(#${uid}-arc-${i})`}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${c} ${c})`}
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${dash} ${circumference}` }}
              transition={{ duration: 1.0, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-display text-2xl font-semibold tracking-tight tabular-nums text-ink">
          {centerLabel}
        </div>
        {centerSub && (
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-soft">
            {centerSub}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Vertical bar chart for daily counts. Highlights today; shows value on hover.
 */
export function BarChart({
  values,
  days,
  color = '#E1B878',
  accent = '#66202A',
  height = 200,
}: {
  values: number[];
  days: string[];
  color?: string;
  accent?: string;
  height?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const padding = { top: 14, right: 8, bottom: 22, left: 8 };
  const w = 640;
  const h = height;
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;
  const n = values.length || 1;
  const max = Math.max(1, ...values);
  const gap = 4;
  const barW = Math.max(2, (innerW - gap * (n - 1)) / n);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={`${uid}-bar-today`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="1" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {values.map((v, i) => {
          const x = padding.left + i * (barW + gap);
          const barH = (v / max) * innerH;
          const y = padding.top + innerH - barH;
          const isToday = i === n - 1;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* Hit area for hover */}
              <rect
                x={x - gap / 2}
                y={padding.top}
                width={barW + gap}
                height={innerH}
                fill="transparent"
              />
              <motion.rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={Math.min(3, barW / 2)}
                fill={isToday ? `url(#${uid}-bar-today)` : `url(#${uid}-bar)`}
                initial={{ height: 0, y: padding.top + innerH }}
                animate={{ height: barH, y }}
                transition={{ duration: 0.6, delay: 0.02 * i, ease: [0.22, 1, 0.36, 1] }}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            </g>
          );
        })}
        {/* X axis labels (first, mid, last) */}
        {[0, Math.floor(n / 2), n - 1].map((i) => {
          if (!days[i]) return null;
          const x = padding.left + i * (barW + gap) + barW / 2;
          const dt = new Date(days[i]);
          return (
            <text
              key={i}
              x={x}
              y={h - 6}
              textAnchor="middle"
              fontSize="10"
              fill="#858585"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 rounded-lg border border-[#E5E5E5] bg-white/95 px-2.5 py-1 text-xs shadow-md backdrop-blur"
          style={{
            left: `${Math.max(10, Math.min(90, ((padding.left + hover * (barW + gap) + barW / 2) / w) * 100))}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="font-mono tabular-nums font-semibold text-ink">{values[hover]}</span>
          <span className="ml-1 text-ink-soft">{values[hover] === 1 ? 'msg' : 'msgs'}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline sparkline for KPI cards. Pure decoration; no axes.
 */
export function Sparkline({
  values,
  color = '#E1B878',
  height = 40,
  width = 120,
}: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  const uid = useId().replace(/:/g, '');
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1 || 1)) * width,
    y: height - ((v - min) / span) * (height - 4) - 2,
  }));
  const path = smoothPath(pts);
  const area = path + ` L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-full w-full overflow-visible"
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${uid}-sp-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid}-sp-fill)`} vectorEffect="non-scaling-stroke" />
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r="2.5"
        fill={color}
        stroke="white"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Radial gauge — used for "publish rate" / content health.
 * Values clamped to 0..1.
 */
export function RadialGauge({
  value,
  size = 140,
  thickness = 12,
  color = '#E1B878',
  accent = '#66202A',
  label,
  sub,
}: {
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  accent?: string;
  label: string;
  sub?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const pct = Math.max(0, Math.min(1, value));
  const r = size / 2 - thickness;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  // Open arc — 270° gauge
  const span = 0.75;
  const arcLen = circumference * span;
  const valueLen = arcLen * pct;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <defs>
          <linearGradient id={`${uid}-rg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={accent} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(25,39,53,0.06)"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circumference}`}
          transform={`rotate(135 ${c} ${c})`}
        />
        {/* Value */}
        <motion.circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#${uid}-rg)`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`0 ${circumference}`}
          animate={{ strokeDasharray: `${valueLen} ${circumference}` }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          transform={`rotate(135 ${c} ${c})`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-display text-2xl font-semibold tracking-tight tabular-nums text-ink">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-soft">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
