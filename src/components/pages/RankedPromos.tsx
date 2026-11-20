"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/** True at the lg breakpoint and up; the mobile detail sheet is only mounted below it. */
function useIsDesktop() {
  const [desk, setDesk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}
import { useStore, DEFAULT_FILTER, type PromoFilter } from "@/components/app/store";
import { Badge, Button, Card, EmptyState, Icon, Segmented, Select } from "@/components/app/ui";
import { PromoDetail, CutTimeline } from "@/components/promo/PromoDetail";
import { epLabel, filterPromos, kindOf, secs, timeLabel } from "@/lib/derive";
import { KIND_COLOR } from "@/lib/derive";

const shape = { headline: "◆", recommended: "●", weak: "▲" } as const;

export default function RankedPromos() {
  const s = useStore();
  const run = s.run;
  const listRef = useRef<HTMLOListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const f = s.filter;
  const promos = useMemo(() => (run ? filterPromos(run.promos, f) : []), [run, f]);
  const counts = useMemo(() => {
    const base = { ...f, status: "all" as const };
    const all = run ? filterPromos(run.promos, base) : [];
    return {
      headline: all.filter((p) => kindOf(p) === "headline").length,
      recommended: all.filter((p) => kindOf(p) !== "weak").length,
      weak: all.filter((p) => kindOf(p) === "weak").length,
      all: all.length,
    };
  }, [run, f]);
  const selected = promos.find((p) => p.id === s.selectedId) ?? null;
  const active = selected ?? promos[0] ?? null;
  const idx = active ? promos.indexOf(active) : -1;
  const isDesktop = useIsDesktop();
  const mobileOpen = Boolean(selected) && !isDesktop;

  const select = (id: string) => s.navigate("promos", id);
  const move = (d: number) => {
    const next = promos[idx + d];
    if (next) select(next.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea")) {
        if (e.key === "Escape") (t as HTMLInputElement).blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!active) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${active.id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!run) {
    return (
      <Card>
        <EmptyState
          icon="promos"
          title="No promos yet"
          action={
            <Button variant="primary" icon="upload" onClick={() => s.navigate("overview")}>
              Go to Overview
            </Button>
          }
        >
          Upload a screenplay ZIP and run an analysis, or open saved results, to see the ranked promos here.
        </EmptyState>
      </Card>
    );
  }

  const arcs = Math.ceil((s.pack?.episodes.at(-1)?.number ?? 50) / 10);
  const filtersActive = JSON.stringify({ ...f, status: DEFAULT_FILTER.status, sort: DEFAULT_FILTER.sort }) !== JSON.stringify({ ...DEFAULT_FILTER });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Ranked promos</h1>
          <p className="mt-0.5 text-sm text-muted">
            {run.meta.mode === "ai" ? `Scored by ${run.meta.provider} / ${run.meta.model}` : "Heuristic Mode — No AI Analysis"} · ranked by quality, then diversity
          </p>
        </div>
        <p className="hidden text-xs text-subtle md:block">
          <kbd className="rounded border border-line bg-surface px-1">↑</kbd> <kbd className="rounded border border-line bg-surface px-1">↓</kbd> to move ·{" "}
          <kbd className="rounded border border-line bg-surface px-1">/</kbd> to search
        </p>
      </div>

      <div className="card flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search promos</span>
            <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              ref={searchRef}
              type="search"
              value={f.query}
              onChange={(e) => s.setFilter({ query: e.target.value })}
              placeholder="Search hooks, cliffhangers, reasons, or an episode like E12"
              className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-subtle"
            />
          </label>
          <Segmented<PromoFilter["status"]>
            label="Status"
            value={f.status}
            onChange={(v) => s.setFilter({ status: v })}
            options={[
              { value: "headline", label: "Post first", count: counts.headline },
              { value: "recommended", label: "Recommended", count: counts.recommended },
              { value: "weak", label: "Weak", count: counts.weak },
              { value: "all", label: "All", count: counts.all },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Select<PromoFilter["sort"]>
            label="Sort"
            value={f.sort}
            onChange={(v) => s.setFilter({ sort: v })}
            options={[
              { value: "rank", label: "Rank" },
              { value: "overall", label: "Overall score" },
              { value: "hook", label: "Hook score" },
              { value: "cliffhanger", label: "Cliffhanger score" },
              { value: "standalone", label: "Standalone score" },
              { value: "duration", label: "Shortest first" },
              { value: "episode", label: "Story order" },
            ]}
          />
          <Select<number>
            label="Arc"
            value={f.arc}
            onChange={(v) => s.setFilter({ arc: v, episode: 0 })}
            options={[{ value: 0, label: "All arcs" }, ...Array.from({ length: arcs }, (_, i) => ({ value: i + 1, label: `Arc ${i + 1} (E${i * 10 + 1}–${(i + 1) * 10})` }))]}
          />
          <Select<PromoFilter["source"]>
            label="Source"
            value={f.source}
            onChange={(v) => s.setFilter({ source: v })}
            options={[
              { value: "all", label: "All sources" },
              { value: "ai", label: "AI-proposed" },
              { value: "heuristic", label: "Rule-based" },
              { value: "stitch", label: "Multi-segment" },
            ]}
          />
          <Select<number>
            label="Min score"
            value={f.minScore}
            onChange={(v) => s.setFilter({ minScore: v })}
            options={[0, 5, 6, 7, 7.5, 8].map((v) => ({ value: v, label: v ? `≥ ${v}` : "Any" }))}
          />
          {f.episode > 0 && (
            <button type="button" onClick={() => s.setFilter({ episode: 0 })} className="inline-flex items-center gap-1 rounded-md bg-navy-soft px-2 py-1 text-xs font-medium text-navy">
              Episode {f.episode} <Icon name="close" size={12} />
            </button>
          )}
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={() => s.setFilter({ ...DEFAULT_FILTER, status: f.status })}>
              Clear filters
            </Button>
          )}
          <span className="tc ml-auto text-xs text-muted">{promos.length} shown</span>
        </div>
      </div>

      {promos.length === 0 ? (
        <Card>
          <EmptyState icon="search" title="No promos match these filters" action={<Button onClick={() => s.setFilter(DEFAULT_FILTER)}>Reset filters</Button>}>
            Try another status, a lower minimum score, or clear the search.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
          <ol ref={listRef} aria-label="Ranked promos" className="card scroll-thin min-h-0 divide-y divide-line overflow-y-auto lg:max-h-[calc(100vh-260px)]">
            {promos.map((p) => {
              const k = kindOf(p);
              const on = active?.id === p.id;
              return (
                <li key={p.id} data-id={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p.id)}
                    aria-current={on ? "true" : undefined}
                    className={`relative flex w-full gap-3 px-3.5 py-3 text-left transition-colors ${on ? "bg-navy-soft" : "hover:bg-surface-2"}`}
                  >
                    {on && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-navy" aria-hidden="true" />}
                    <span className="flex w-7 shrink-0 flex-col items-center pt-0.5">
                      <span className="tc text-sm font-semibold text-ink">{p.rank}</span>
                      <span className="text-[11px]" style={{ color: KIND_COLOR[k] }} aria-label={k}>
                        {shape[k]}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {epLabel(p)} <span className="tc font-normal text-muted">{timeLabel(p)}</span>
                        </span>
                        <span className="tc shrink-0 text-[13px] font-semibold text-ink">{p.evaluation.overall.toFixed(2)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-2">{p.evaluation.hook}</span>
                      <span className="mt-2 flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <CutTimeline promo={p} episodes={s.episodes} compact />
                        </span>
                        <span className="tc shrink-0 text-[11px] text-subtle">{secs(p.candidate.durationCs)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Desktop detail panel */}
          <div className="card hidden min-h-0 overflow-hidden lg:block lg:max-h-[calc(100vh-260px)]">
            {active && isDesktop && (
              <PromoDetail
                promo={active}
                episodes={s.episodes}
                onPrev={idx > 0 ? () => move(-1) : undefined}
                onNext={idx < promos.length - 1 ? () => move(1) : undefined}
                position={`${idx + 1} of ${promos.length}`}
              />
            )}
          </div>

          {/* Mobile detail sheet */}
          {mobileOpen && selected && (
            <div className="fixed inset-0 z-40 flex flex-col bg-surface lg:hidden" role="dialog" aria-modal="true" aria-label={`Promo ${selected.rank}`}>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => s.navigate("promos")}>
                  Back to list
                </Button>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" icon="chevronUp" onClick={() => move(-1)} disabled={idx <= 0} aria-label="Previous promo" />
                  <Button size="sm" variant="ghost" icon="chevronDown" onClick={() => move(1)} disabled={idx >= promos.length - 1} aria-label="Next promo" />
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <PromoDetail promo={selected} episodes={s.episodes} />
              </div>
            </div>
          )}
        </div>
      )}
      {run.meta.mode === "heuristic" && (
        <p className="text-xs text-muted">
          <Badge tone="amber">Heuristic</Badge> Rule-based estimates only. Every promo needs a human check.
        </p>
      )}
    </div>
  );
}
