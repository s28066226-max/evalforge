"use client";

import { useEffect, useRef, useState } from "react";

/** Track the container's pixel width so SVG text renders at a true 1:1 size at any breakpoint. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
  title: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.title}</strong>
      {tip.lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

// ---------- Cost vs quality scatter ----------

export interface ScatterPoint {
  label: string;
  color: string;
  x: number;
  y: number;
  details: string[];
}

function niceLogTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min && v <= max) ticks.push(v);
    }
  }
  return ticks;
}

/** Nice linear ticks (1, 2, 5 x 10^n steps) covering [min, max]. */
function niceLinearTicks(min: number, max: number, target = 5): number[] {
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const X_FORMATS = {
  usd: (v: number) => (v < 0.001 ? `$${v.toExponential(0)}` : `$${v}`),
  seconds: (v: number) => `${v}s`,
};

export function QualityScatter({
  points,
  xLabel,
  yLabel,
  xScale,
  xFormat,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xScale: "log" | "linear";
  xFormat: keyof typeof X_FORMATS;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth(480);
  const H = 300;
  // Labels sit beside the dots when there's room, above them on narrow screens.
  const labelFits = W >= 420;
  const m = { top: 30, right: labelFits ? Math.min(130, W * 0.28) : 40, bottom: 44, left: 48 };
  const valid = points.filter((p) => p.x > 0 && !Number.isNaN(p.y));
  if (valid.length === 0) return <p className="caption">No data for this chart yet.</p>;

  const xs = valid.map((p) => p.x);
  const log = xScale === "log";
  const xMin = log ? Math.min(...xs) / 2 : 0;
  const xMax = log ? Math.max(...xs) * 2 : Math.max(...xs) * 1.15;
  const yMin = Math.max(0, Math.floor((Math.min(...valid.map((p) => p.y)) - 0.05) * 10) / 10);
  const yMax = 1;

  const t = (v: number) => (log ? Math.log10(v) : v);
  const sx = (v: number) => m.left + ((t(v) - t(xMin)) / (t(xMax) - t(xMin))) * (W - m.left - m.right);
  const sy = (v: number) => m.top + (1 - (v - yMin) / (yMax - yMin)) * (H - m.top - m.bottom);
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / 0.1) + 1 }, (_, i) => yMin + i * 0.1);
  // Drop ticks that would sit closer than ~56px to the previous one.
  const xTicks = (log ? niceLogTicks(xMin, xMax) : niceLinearTicks(xMin, xMax)).reduce<number[]>((kept, tick) => {
    if (!kept.length || sx(tick) - sx(kept[kept.length - 1]) >= 56) kept.push(tick);
    return kept;
  }, []);
  const fmtX = X_FORMATS[xFormat];

  // Nudge labels apart so models with similar scores don't print on top of each other.
  const labelY = new Map<string, number>();
  let prev = -Infinity;
  for (const p of [...valid].sort((a, b) => sy(a.y) - sy(b.y))) {
    const y = Math.max(labelFits ? sy(p.y) + 4 : sy(p.y) - 12, prev + 15);
    labelY.set(p.label, y);
    prev = y;
  }

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={W} height={H} role="img" aria-label={`${yLabel} versus ${xLabel} per model`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={W - m.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={m.left - 8} y={sy(t) + 4} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - m.bottom + 18} textAnchor="middle">
            {fmtX(t)}
          </text>
        ))}
        <text className="axis-title" x={(m.left + W - m.right) / 2} y={H - 6} textAnchor="middle">
          {xLabel}
          {log ? " (log scale)" : ""} →
        </text>
        <text className="axis-title" x={4} y={12}>
          ↑ {yLabel}
        </text>
        {valid.map((p) => {
          const cx = sx(p.x);
          const cy = sy(p.y);
          const ly = labelY.get(p.label)!;
          const show = () => setTip({ x: cx, y: cy, title: p.label, lines: p.details });
          return (
            <g key={p.label} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} tabIndex={0}>
              <circle cx={cx} cy={cy} r={18} fill="transparent" />
              <circle cx={cx} cy={cy} r={7} fill={p.color} stroke="var(--surface-1)" strokeWidth={2} />
              <text
                x={labelFits ? cx + 12 : cx}
                y={ly}
                textAnchor={labelFits ? "start" : "middle"}
                style={{ fill: "var(--text-primary)", fontWeight: 600 }}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Forest plot: effect size with 95% CI vs baseline ----------

export interface ForestRow {
  label: string;
  color: string;
  diff: number;
  ci: [number, number];
  significant: boolean;
  details: string[];
}

export function ForestPlot({ rows, unit, scale = 1 }: { rows: ForestRow[]; unit: string; scale?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth(420);
  const rowH = 34;
  const m = { top: 8, right: 16, bottom: 30, left: 16 };
  const H = m.top + rows.length * rowH + m.bottom;
  if (rows.length === 0) return <p className="caption">No comparisons.</p>;

  const ext = Math.max(...rows.flatMap((r) => [Math.abs(r.ci[0]), Math.abs(r.ci[1]), Math.abs(r.diff)])) * scale || 1;
  const lim = ext * 1.15;
  const sx = (v: number) => m.left + ((v * scale + lim) / (2 * lim)) * (W - m.left - m.right);
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}${unit}`;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={W} height={H} role="img" aria-label="Difference from baseline with 95% confidence intervals">
        <line x1={sx(0)} x2={sx(0)} y1={m.top} y2={H - m.bottom} stroke="var(--text-muted)" strokeDasharray="3 3" />
        {[-lim, 0, lim].map((t) => (
          <text key={t} x={m.left + ((t + lim) / (2 * lim)) * (W - m.left - m.right)} y={H - 10} textAnchor="middle">
            {t === 0 ? "baseline" : fmt(t)}
          </text>
        ))}
        {rows.map((r, i) => {
          const cy = m.top + i * rowH + rowH / 2 + 6;
          const cx = sx(r.diff);
          const show = () => setTip({ x: cx, y: cy, title: r.label, lines: r.details });
          return (
            <g key={r.label} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} tabIndex={0}>
              <rect x={m.left} y={cy - rowH / 2 - 6} width={W - m.left - m.right} height={rowH} fill="transparent" />
              <text x={m.left} y={cy - 9} style={{ fill: "var(--text-primary)" }}>
                {r.label}
              </text>
              <line x1={sx(r.ci[0])} x2={sx(r.ci[1])} y1={cy + 3} y2={cy + 3} stroke={r.color} strokeWidth={2} strokeLinecap="round" />
              <circle
                cx={cx}
                cy={cy + 3}
                r={5}
                fill={r.significant ? r.color : "var(--surface-1)"}
                stroke={r.color}
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
