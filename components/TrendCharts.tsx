"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Trends } from "@/lib/trends";
import { fmtMoney } from "@/lib/money";

/**
 * Trend charts for the full report. Single-hue by design (the brand palette is muted, so
 * identity never rests on hue): emphasis = the accent, context = a lighter step of it,
 * and a filled-vs-outlined pair for this year against last year. Every chart has a hover
 * tooltip and a table twin elsewhere on the page.
 */

const PAD = { l: 44, r: 12, t: 10, b: 26 };

/** Measure the container so the SVG renders at real pixel width and text stays legible. */
function useWidth(fallback = 560): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; key?: "fill" | "outline" | "line" | "muted" }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: `${tip.x}%`, top: tip.y }}>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="chart-tip-row">
          {r.key && <span className={`chart-key ${r.key}`} />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function Frame({ W, height, children, ticks, max, xLabels, emphasisIdx }: { W: number; height: number; children: React.ReactNode; ticks: number[]; max: number; xLabels: string[]; emphasisIdx?: Set<number> }) {
  const H = height;
  const plotH = H - PAD.t - PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const slot = plotW / xLabels.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="chart" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="chart-tick">
            {compact(t)}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="chart-axis" />
      {xLabels.map((l, i) => (
        <text key={i} x={PAD.l + slot * i + slot / 2} y={H - 8} textAnchor="middle" className={`chart-tick${emphasisIdx?.has(i) ? " strong" : ""}`}>
          {l}
        </text>
      ))}
      {children}
    </svg>
  );
}

/** Single-series column chart with emphasis on the selected months. */
export function MonthlyBars({ points }: { points: Trends["trailing"] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth();
  const H = 200;
  const max = niceMax(Math.max(...points.map((p) => p.total), 1) * 1.1);
  const ticks = [0, max / 2, max];
  const plotH = H - PAD.t - PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / points.length;
  const bw = Math.min(24, slot * 0.6);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const maxIdx = points.reduce((best, p, i) => (p.total > points[best].total ? i : best), 0);
  const emphasis = new Set(points.map((p, i) => (p.inPeriod ? i : -1)).filter((i) => i >= 0));

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={() => setTip(null)}>
      <Frame W={W} height={H} ticks={ticks} max={max} xLabels={points.map((p) => p.label)} emphasisIdx={emphasis}>
        {points.map((p, i) => {
          const x = PAD.l + slot * i + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(p.total));
          const showLabel = i === maxIdx && p.total > 0;
          return (
            <g key={p.month}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseMove={() =>
                  setTip({
                    x: ((PAD.l + slot * i + slot / 2) / W) * 100,
                    y: Math.max(0, y(p.total) - 8),
                    title: p.longLabel,
                    rows: [
                      { label: `${p.count} receipt${p.count === 1 ? "" : "s"}`, value: fmtMoney(p.total), key: p.inPeriod ? "fill" : "muted" },
                      ...(p.topCategory ? [{ label: "largest category", value: p.topCategory }] : []),
                    ],
                  })
                }
              />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} 4,-${Math.min(4, h)} h${bw - 8} q4,0 4,${Math.min(4, h)} v${h - Math.min(4, h)} z`}
                  className={`chart-bar${p.inPeriod ? " emphasis" : ""}`}
                />
              )}
              {showLabel && (
                <text x={x + bw / 2} y={y(p.total) - 6} textAnchor="middle" className="chart-value">
                  {fmtMoney(p.total)}
                </text>
              )}
            </g>
          );
        })}
      </Frame>
      <Tooltip tip={tip} />
    </div>
  );
}

/** This year vs last year: filled columns for the current year, outlined for the previous. */
export function YearBars({ yc }: { yc: Trends["yearCompare"] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth();
  const H = 200;
  const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const max = niceMax(Math.max(...yc.current, ...yc.previous, 1) * 1.1);
  const ticks = [0, max / 2, max];
  const plotH = H - PAD.t - PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / 12;
  const bw = Math.min(18, slot * 0.34);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={() => setTip(null)}>
      <div className="chart-legend">
        <span>
          <span className="chart-key fill" /> {yc.year}
        </span>
        <span>
          <span className="chart-key outline" /> {yc.year - 1}
        </span>
      </div>
      <Frame W={W} height={H} ticks={ticks} max={max} xLabels={labels}>
        {labels.map((_, i) => {
          const base = PAD.l + slot * i + slot / 2;
          const cur = yc.current[i];
          const prev = yc.previous[i];
          return (
            <g key={i}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseMove={() =>
                  setTip({
                    x: (base / W) * 100,
                    y: Math.max(0, Math.min(y(cur), y(prev)) - 8),
                    title: long[i],
                    rows: [
                      { label: String(yc.year), value: fmtMoney(cur), key: "fill" },
                      { label: String(yc.year - 1), value: fmtMoney(prev), key: "outline" },
                      ...(prev > 0 ? [{ label: "change", value: `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%` }] : []),
                    ],
                  })
                }
              />
              {prev > 0 && <rect x={base - bw - 1} y={y(prev)} width={bw} height={y(0) - y(prev)} className="chart-bar outline" rx={0} />}
              {cur > 0 && <rect x={base + 1} y={y(cur)} width={bw} height={y(0) - y(cur)} className="chart-bar emphasis" rx={0} />}
            </g>
          );
        })}
      </Frame>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Cumulative spend through the year, this year (accent) vs last year (muted). */
export function CumulativeLines({ yc }: { yc: Trends["yearCompare"] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth();
  const H = 200;
  const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const n = Math.max(1, yc.monthsElapsed);
  const curPts = yc.currentCumulative.slice(0, n);
  const max = niceMax(Math.max(...curPts, ...yc.previousCumulative, 1) * 1.1);
  const ticks = [0, max / 2, max];
  const plotH = H - PAD.t - PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / 12;
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const gid = useId();

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={() => setTip(null)}>
      <div className="chart-legend">
        <span>
          <span className="chart-key line" /> {yc.year} to date
        </span>
        <span>
          <span className="chart-key muted" /> {yc.year - 1}
        </span>
      </div>
      <Frame W={W} height={H} ticks={ticks} max={max} xLabels={labels}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="chart-area-stop" />
            <stop offset="1" className="chart-area-stop" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={path(yc.previousCumulative)} className="chart-line muted" />
        {curPts.length > 0 && (
          <>
            <path d={`${path(curPts)} L${x(curPts.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />
            <path d={path(curPts)} className="chart-line" />
            <circle cx={x(curPts.length - 1)} cy={y(curPts[curPts.length - 1])} r={4.5} className="chart-dot" />
            <text x={x(curPts.length - 1)} y={y(curPts[curPts.length - 1]) - 10} className="chart-value" textAnchor={curPts.length > 9 ? "end" : "middle"}>
              {fmtMoney(curPts[curPts.length - 1])}
            </text>
          </>
        )}
        {labels.map((_, i) => (
          <rect
            key={i}
            x={PAD.l + slot * i}
            y={PAD.t}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseMove={() =>
              setTip({
                x: (x(i) / W) * 100,
                y: Math.max(0, y(Math.max(yc.previousCumulative[i], curPts[i] ?? 0)) - 8),
                title: `Through ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i]}`,
                rows: [
                  ...(i < curPts.length ? [{ label: `${yc.year} to date`, value: fmtMoney(curPts[i]), key: "line" as const }] : []),
                  { label: String(yc.year - 1), value: fmtMoney(yc.previousCumulative[i]), key: "muted" as const },
                ],
              })
            }
          />
        ))}
      </Frame>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Small multiples: one mini column chart per top category, same hue, shared scale. */
export function CategorySmallMultiples({ cats }: { cats: Trends["categories"] }) {
  const [tip, setTip] = useState<{ cat: string; i: number } | null>(null);
  const max = niceMax(Math.max(...cats.flatMap((c) => c.points.map((p) => p.total)), 1) * 1.05);
  const w = 220;
  const h = 96;
  const slot = w / 12;
  const bw = Math.min(10, slot * 0.6);
  const y = (v: number) => h - 14 - (v / max) * (h - 18);
  return (
    <div className="multiples">
      {cats.map((c) => (
        <div key={c.category} className="multiple" onMouseLeave={() => setTip(null)}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="small" style={{ fontWeight: 500 }}>
              {c.category}
            </span>
            <span className="small muted">{fmtMoney(c.total)}</span>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }} className="chart" role="img">
            <line x1={0} x2={w} y1={h - 14} y2={h - 14} className="chart-axis" />
            {c.points.map((p, i) => (
              <g key={p.month}>
                <rect x={slot * i} y={0} width={slot} height={h - 14} fill="transparent" onMouseMove={() => setTip({ cat: c.category, i })} />
                {p.total > 0 && <rect x={slot * i + (slot - bw) / 2} y={y(p.total)} width={bw} height={h - 14 - y(p.total)} rx={2} className={`chart-bar${tip?.cat === c.category && tip.i === i ? " emphasis" : ""}`} />}
                {(i === 0 || i === 11) && (
                  <text x={slot * i + slot / 2} y={h - 3} textAnchor="middle" className="chart-tick">
                    {p.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
          <div className="small muted" style={{ minHeight: 16 }}>
            {tip?.cat === c.category ? `${c.points[tip.i].label}: ${fmtMoney(c.points[tip.i].total)}` : " "}
          </div>
        </div>
      ))}
    </div>
  );
}
