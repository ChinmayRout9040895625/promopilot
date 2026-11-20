"use client";
/**
 * Dependency-free SVG charts. Colours come from validated tokens (--c-post / --c-rec / --c-weak),
 * every mark has a hover tooltip, and status is never colour alone (legend + shape + text).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Promo } from "@/core/types";
import { KIND_COLOR, KIND_LABEL, kindOf, type EpisodeStat, type PromoKind } from "@/lib/derive";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 90), Math.max(90, width - 90));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink shadow-[var(--shadow-lg)]"
      style={{ left, top: tip.y - 8 }}
    >
      {tip.content}
    </div>
  );
}

export function Legend({ items }: { items: { kind: PromoKind | "none"; label?: string }[] }) {
  const shape: Record<string, string> = { headline: "◆", recommended: "●", weak: "▲", none: "○" };
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.kind} className="inline-flex items-center gap-1.5">
          <span style={{ color: KIND_COLOR[i.kind] }} aria-hidden="true">
            {shape[i.kind]}
          </span>
          {i.label ?? (i.kind === "none" ? "No promo" : KIND_LABEL[i.kind as PromoKind])}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- episode film strip (overview)

export function EpisodeStrip({ stats, onSelect }: { stats: EpisodeStat[]; onSelect: (ep: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div ref={ref} className="relative">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 25)}, minmax(0, 1fr))` }}>
        {stats.map((s) => (
          <button
            key={s.episode}
            type="button"
            onClick={() => onSelect(s.episode)}
            onMouseEnter={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pr = ref.current!.getBoundingClientRect();
              setTip({
                x: r.left - pr.left + r.width / 2,
                y: r.top - pr.top,
                content: (
                  <>
                    <p className="font-semibold">Episode {s.episode}</p>
                    <p className="text-muted">
                      {s.headline} post first · {s.recommended} recommended · {s.weak} weak
                    </p>
                    {s.best && <p className="tc mt-0.5">Best: #{s.best.rank}, {s.best.evaluation.overall.toFixed(2)}</p>}
                  </>
                ),
              });
            }}
            onMouseLeave={() => setTip(null)}
            onFocus={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pr = ref.current!.getBoundingClientRect();
              setTip({ x: r.left - pr.left + r.width / 2, y: r.top - pr.top, content: <p>Episode {s.episode}: {s.kind === "none" ? "no promo" : KIND_LABEL[s.kind as PromoKind]}</p> });
            }}
            onBlur={() => setTip(null)}
            aria-label={`Episode ${s.episode}: ${s.kind === "none" ? "no promo" : `best is ${KIND_LABEL[s.kind as PromoKind]}`}. Show its promos.`}
            className="group relative flex h-10 flex-col items-center justify-end overflow-hidden rounded-[5px] border border-line bg-surface-2 transition-transform hover:-translate-y-0.5"
          >
            <span className="absolute inset-x-0 bottom-0" style={{ height: `${s.best ? Math.max(18, s.best.evaluation.overall * 10) : 0}%`, background: KIND_COLOR[s.kind], opacity: 0.9 }} />
            <span className={`tc relative pb-0.5 text-[10px] font-semibold ${s.kind === "none" ? "text-subtle" : s.kind === "weak" ? "text-[#1f1300]" : "text-white"}`}>{s.episode}</span>
          </button>
        ))}
      </div>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------------------------------------------------------------- per-episode bar chart (analytics)

export function EpisodeBars({ stats, onSelect, arcSize = 10 }: { stats: EpisodeStat[]; onSelect: (ep: number) => void; arcSize?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const m = { t: 24, r: 8, b: 26, l: 28 };
  const iw = Math.max(0, width - m.l - m.r);
  const ih = H - m.t - m.b;
  const n = stats.length || 1;
  const step = iw / n;
  const bw = Math.max(2, step - 2);
  const y = (v: number) => m.t + ih - (v / 10) * ih;
  const arcs = Math.ceil(n / arcSize);
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Best promo score per episode, coloured by status">
          {[0, 2.5, 5, 7.5, 10].map((g) => (
            <g key={g}>
              <line x1={m.l} x2={width - m.r} y1={y(g)} y2={y(g)} stroke="var(--c-grid)" />
              <text x={m.l - 6} y={y(g) + 3.5} textAnchor="end" fontSize="10" fill="var(--c-axis)" className="tc">
                {g}
              </text>
            </g>
          ))}
          {Array.from({ length: arcs }, (_, a) => {
            const x0 = m.l + a * arcSize * step;
            return (
              <g key={a}>
                {a > 0 && <line x1={x0} x2={x0} y1={m.t - 14} y2={m.t + ih} stroke="var(--line-strong)" strokeDasharray="2 3" />}
                <text x={x0 + 4} y={m.t - 8} fontSize="10" fill="var(--c-axis)">
                  Arc {a + 1}
                </text>
              </g>
            );
          })}
          {stats.map((s, i) => {
            const v = s.best?.evaluation.overall ?? 0;
            const x = m.l + i * step + 1;
            const h = Math.max(s.best ? 2 : 0, (v / 10) * ih);
            return (
              <g key={s.episode}>
                <rect
                  x={x}
                  y={m.t + ih - h}
                  width={bw}
                  height={h}
                  rx={Math.min(3, bw / 2)}
                  fill={KIND_COLOR[s.kind]}
                  opacity={hover === null || hover === s.episode ? 1 : 0.45}
                />
                {!s.best && <rect x={x} y={m.t + ih - 3} width={bw} height={3} rx={1} fill="var(--c-none)" />}
                <rect
                  x={m.l + i * step}
                  y={m.t}
                  width={step}
                  height={ih}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => onSelect(s.episode)}
                  onMouseEnter={() => {
                    setHover(s.episode);
                    setTip({
                      x: x + bw / 2,
                      y: m.t + ih - h,
                      content: (
                        <>
                          <p className="font-semibold">Episode {s.episode}</p>
                          {s.best ? (
                            <>
                              <p className="tc">Best {s.best.evaluation.overall.toFixed(2)} · #{s.best.rank} · {KIND_LABEL[s.kind as PromoKind]}</p>
                              <p className="text-muted">{s.promos} promo{s.promos === 1 ? "" : "s"} · click to view</p>
                            </>
                          ) : (
                            <p className="text-muted">No accepted promo</p>
                          )}
                        </>
                      ),
                    });
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                />
                {(i % (n > 30 ? 5 : 1) === 0 || i === n - 1) && (
                  <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--c-axis)" className="tc">
                    {s.episode}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------------------------------------------------------------- stacked histogram

export function StackedHistogram({
  bins,
  formatBin,
  height = 200,
  ariaLabel,
}: {
  bins: { lo: number; hi: number; headline: number; recommended: number; weak: number }[];
  formatBin: (lo: number, hi: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const m = { t: 10, r: 8, b: 26, l: 30 };
  const iw = Math.max(0, width - m.l - m.r);
  const ih = height - m.t - m.b;
  const max = Math.max(1, ...bins.map((b) => b.headline + b.recommended + b.weak));
  const nice = Math.ceil(max / 5) * 5 || 5;
  const step = iw / Math.max(1, bins.length);
  const bw = Math.max(4, step - 6);
  const y = (v: number) => (v / nice) * ih;
  const kinds: PromoKind[] = ["headline", "recommended", "weak"];
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {[0, nice / 2, nice].map((g) => (
            <g key={g}>
              <line x1={m.l} x2={width - m.r} y1={m.t + ih - y(g)} y2={m.t + ih - y(g)} stroke="var(--c-grid)" />
              <text x={m.l - 6} y={m.t + ih - y(g) + 3.5} textAnchor="end" fontSize="10" fill="var(--c-axis)" className="tc">
                {g}
              </text>
            </g>
          ))}
          {bins.map((b, i) => {
            let acc = 0;
            const x = m.l + i * step + (step - bw) / 2;
            const total = b.headline + b.recommended + b.weak;
            return (
              <g key={i}>
                {kinds.map((k) => {
                  const v = b[k];
                  if (!v) return null;
                  const h = y(v);
                  const top = m.t + ih - acc - h;
                  acc += h + 2;
                  return <rect key={k} x={x} y={top + 2} width={bw} height={Math.max(1, h - 2)} rx={2} fill={KIND_COLOR[k]} />;
                })}
                <rect
                  x={m.l + i * step}
                  y={m.t}
                  width={step}
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: x + bw / 2,
                      y: m.t + ih - y(total),
                      content: (
                        <>
                          <p className="font-semibold">{formatBin(b.lo, b.hi)}</p>
                          <p className="tc text-muted">
                            {total} promo{total === 1 ? "" : "s"}: {b.headline} post first, {b.recommended} recommended, {b.weak} weak
                          </p>
                        </>
                      ),
                    })
                  }
                  onMouseLeave={() => setTip(null)}
                />
                <text x={x + bw / 2} y={height - 10} textAnchor="middle" fontSize="10" fill="var(--c-axis)" className="tc">
                  {formatBin(b.lo, b.hi).split("–")[0]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------------------------------------------------------------- hook vs cliffhanger scatter

export function HookCliffScatter({ promos, onSelect }: { promos: Promo[]; onSelect: (id: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const H = 280;
  const m = { t: 12, r: 12, b: 34, l: 36 };
  const iw = Math.max(0, width - m.l - m.r);
  const ih = H - m.t - m.b;
  const x = (v: number) => m.l + (v / 10) * iw;
  const y = (v: number) => m.t + ih - (v / 10) * ih;
  // Deterministic jitter so integer scores don't stack on one point.
  const jitter = (id: string, axis: number) => {
    let h = axis * 7919;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return ((h % 100) / 100 - 0.5) * 0.55;
  };
  const order: PromoKind[] = ["weak", "recommended", "headline"];
  const sorted = [...promos].sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b)));
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Hook score against cliffhanger score for each promo">
          <rect x={x(0)} y={y(5)} width={x(5) - x(0)} height={y(0) - y(5)} fill="var(--amber-soft)" opacity="0.6" />
          <rect x={x(5)} y={y(10)} width={x(10) - x(5)} height={y(5) - y(10)} fill="var(--teal-soft)" opacity="0.6" />
          <text x={x(10) - 6} y={y(10) + 14} textAnchor="end" fontSize="10" fill="var(--teal)">
            both pass
          </text>
          {[0, 2, 4, 6, 8, 10].map((g) => (
            <g key={g}>
              <line x1={x(g)} x2={x(g)} y1={m.t} y2={m.t + ih} stroke="var(--c-grid)" />
              <line x1={m.l} x2={m.l + iw} y1={y(g)} y2={y(g)} stroke="var(--c-grid)" />
              <text x={x(g)} y={H - 18} textAnchor="middle" fontSize="10" fill="var(--c-axis)" className="tc">
                {g}
              </text>
              <text x={m.l - 8} y={y(g) + 3.5} textAnchor="end" fontSize="10" fill="var(--c-axis)" className="tc">
                {g}
              </text>
            </g>
          ))}
          <line x1={x(5)} x2={x(5)} y1={m.t} y2={m.t + ih} stroke="var(--line-strong)" strokeDasharray="3 3" />
          <line x1={m.l} x2={m.l + iw} y1={y(5)} y2={y(5)} stroke="var(--line-strong)" strokeDasharray="3 3" />
          <text x={m.l + iw / 2} y={H - 3} textAnchor="middle" fontSize="11" fill="var(--muted)">
            Hook score
          </text>
          <text x={10} y={m.t + ih / 2} textAnchor="middle" fontSize="11" fill="var(--muted)" transform={`rotate(-90 10 ${m.t + ih / 2})`}>
            Cliffhanger
          </text>
          {sorted.map((p) => {
            const k = kindOf(p);
            const cx = x(p.evaluation.scores.hook + jitter(p.id, 1));
            const cy = y(p.evaluation.scores.cliffhanger + jitter(p.id, 2));
            const on = hover === p.id;
            const r = on ? 6 : 4.5;
            const common = {
              fill: KIND_COLOR[k],
              stroke: "var(--surface)",
              strokeWidth: 1.5,
              className: "cursor-pointer",
              onClick: () => onSelect(p.id),
              onMouseEnter: () => {
                setHover(p.id);
                setTip({
                  x: cx,
                  y: cy - 6,
                  content: (
                    <>
                      <p className="font-semibold">
                        #{p.rank} · E{p.candidate.segments[0].episode} · {KIND_LABEL[k]}
                      </p>
                      <p className="tc text-muted">
                        Hook {p.evaluation.scores.hook}, cliffhanger {p.evaluation.scores.cliffhanger}, overall {p.evaluation.overall.toFixed(2)}
                      </p>
                    </>
                  ),
                });
              },
              onMouseLeave: () => {
                setHover(null);
                setTip(null);
              },
            };
            if (k === "headline") return <rect key={p.id} x={cx - r} y={cy - r} width={r * 2} height={r * 2} transform={`rotate(45 ${cx} ${cy})`} {...common} />;
            if (k === "weak") return <polygon key={p.id} points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`} {...common} />;
            return <circle key={p.id} cx={cx} cy={cy} r={r} {...common} />;
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars (funnel, warnings)

export function HBars({ rows, max, tone = "teal", unit = "" }: { rows: { label: string; value: number; note?: string }[]; max?: number; tone?: "teal" | "navy" | "amber"; unit?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  const color = tone === "navy" ? "var(--c-post)" : tone === "amber" ? "var(--c-weak)" : "var(--c-rec)";
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink-2" title={r.label}>
              {r.label}
            </span>
            <span className="tc shrink-0 font-semibold text-ink">
              {r.value}
              {unit}
            </span>
          </div>
          <div className="h-2 rounded-full bg-track" title={r.note}>
            <div className="h-2 rounded-full" style={{ width: `${Math.max(1, (r.value / top) * 100)}%`, background: color }} />
          </div>
          {r.note && <p className="mt-1 text-[11.5px] text-muted">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}
