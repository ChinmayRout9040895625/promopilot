"use client";
import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "@/components/app/store";
import { Button, Card, EmptyState, Segmented, Select } from "@/components/app/ui";
import { EpisodeBars, HBars, HookCliffScatter, Legend, StackedHistogram } from "@/components/charts/charts";
import { computeMetrics } from "@/core/export";
import { episodeStats, funnel, histogram, KIND_LABEL, warningCounts, type PromoKind } from "@/lib/derive";
import type { Promo } from "@/core/types";

type Scope = "all" | "recommended";
type Metric = "overall" | "hook" | "cliffhanger" | "standalone" | "intensity" | "appeal";

function ChartCard({ title, subtitle, legend, table, children }: { title: string; subtitle?: string; legend?: ReactNode; table?: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      action={
        <div className="flex flex-wrap items-center gap-3">
          {!asTable && legend}
          {table && (
            <Button size="sm" variant="ghost" icon={asTable ? "analytics" : "table"} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
              {asTable ? "Chart" : "Table"}
            </Button>
          )}
        </div>
      }
    >
      <div className="px-3 py-4">{asTable ? <div className="scroll-thin max-h-[320px] overflow-auto">{table}</div> : children}</div>
    </Card>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="tc w-full text-left text-[13px]">
      <thead className="sticky top-0 bg-surface text-xs text-muted">
        <tr>
          {head.map((h) => (
            <th key={h} className="border-b border-line px-2 py-1.5 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className="px-2 py-1.5 text-ink-2">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const metricValue = (m: Metric) => (p: Promo) => (m === "overall" ? p.evaluation.overall : p.evaluation.scores[m]);
const allKinds: { kind: PromoKind }[] = [{ kind: "headline" }, { kind: "recommended" }, { kind: "weak" }];

export default function Analytics() {
  const s = useStore();
  const run = s.run;
  const [scope, setScope] = useState<Scope>("all");
  const [source, setSource] = useState<"all" | "ai" | "heuristic" | "stitch">("all");
  const [metric, setMetric] = useState<Metric>("overall");

  const promos = useMemo(
    () => (run ? run.promos.filter((p) => (scope === "all" || p.status === "recommended") && (source === "all" || p.candidate.source === source)) : []),
    [run, scope, source],
  );
  const scoped = useMemo(() => (run ? { ...run, promos } : null), [run, promos]);
  const stats = useMemo(() => (scoped ? episodeStats(scoped, s.pack?.episodes ?? []) : []), [scoped, s.pack]);
  const scoreBins = useMemo(() => histogram(promos, metricValue(metric), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [promos, metric]);
  const durBins = useMemo(() => histogram(promos, (p) => p.candidate.durationCs / 100, [20, 25, 30, 35, 40, 45, 50, 55, 60]), [promos]);
  const funnelRows = useMemo(() => (run ? funnel(run) : []), [run]);
  const warnings = useMemo(() => (scoped ? warningCounts(scoped) : []), [scoped]);
  const compare = useMemo(() => (run && s.baseline && run.meta.mode === "ai" ? { ai: computeMetrics(run), h: computeMetrics(s.baseline) } : null), [run, s.baseline]);

  if (!run) {
    return (
      <Card>
        <EmptyState icon="analytics" title="Nothing to analyse yet" action={<Button variant="primary" onClick={() => s.navigate("overview")}>Go to Overview</Button>}>
          Charts of scores, coverage and the candidate funnel appear once a run or saved results are loaded.
        </EmptyState>
      </Card>
    );
  }

  const metricLabel = { overall: "Overall", hook: "Hook", cliffhanger: "Cliffhanger", standalone: "Standalone", intensity: "Intensity", appeal: "Appeal" }[metric];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Analytics</h1>
        <p className="mt-0.5 text-sm text-muted">How the promos are distributed across the season, and where candidates were filtered out. Hover any mark; click to open the promo.</p>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <Segmented<Scope>
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All accepted", count: run.promos.length },
            { value: "recommended", label: "Recommended only", count: run.promos.filter((p) => p.status === "recommended").length },
          ]}
        />
        <Select
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "All sources" },
            { value: "ai", label: "AI-proposed" },
            { value: "heuristic", label: "Rule-based" },
            { value: "stitch", label: "Multi-segment" },
          ]}
        />
        <span className="tc ml-auto text-xs text-muted">{promos.length} promos in view</span>
      </div>

      <ChartCard
        title="Best promo per episode"
        subtitle="Bar height is the episode's best score in view; colour is that promo's status. Click a bar to list the episode's promos."
        legend={<Legend items={[...allKinds, { kind: "none" }]} />}
        table={
          <SimpleTable
            head={["Episode", "Best score", "Status", "Post first", "Recommended", "Weak"]}
            rows={stats.map((e) => [e.episode, e.best ? e.best.evaluation.overall.toFixed(2) : "—", e.kind === "none" ? "No promo" : KIND_LABEL[e.kind], e.headline, e.recommended, e.weak])}
          />
        }
      >
        <EpisodeBars stats={stats} onSelect={s.showEpisode} />
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <ChartCard
          title={`${metricLabel} score distribution`}
          subtitle="Promos per score band, stacked by status"
          legend={<Legend items={allKinds} />}
          table={<SimpleTable head={["Band", "Post first", "Recommended", "Weak"]} rows={scoreBins.map((b) => [`${b.lo}–${b.hi}`, b.headline, b.recommended, b.weak])} />}
        >
          <div className="mb-3 overflow-x-auto">
            <Segmented<Metric>
              size="sm"
              label="Score"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "overall", label: "Overall" },
                { value: "hook", label: "Hook" },
                { value: "cliffhanger", label: "Cliffhanger" },
                { value: "standalone", label: "Standalone" },
                { value: "intensity", label: "Intensity" },
                { value: "appeal", label: "Appeal" },
              ]}
            />
          </div>
          <StackedHistogram bins={scoreBins} formatBin={(lo, hi) => `${lo}–${hi}`} ariaLabel={`Histogram of ${metricLabel} scores`} />
        </ChartCard>

        <ChartCard
          title="Hook vs cliffhanger"
          subtitle="Each mark is a promo. The shaded top-right passes both score gates; weak marks inside it failed the judge's yes/no checks (dull opening, no curiosity, or not standalone)."
          legend={<Legend items={allKinds} />}
          table={
            <SimpleTable
              head={["Rank", "Episode", "Hook", "Cliffhanger", "Overall"]}
              rows={promos.map((p) => [p.rank, p.candidate.segments[0].episode, p.evaluation.scores.hook, p.evaluation.scores.cliffhanger, p.evaluation.overall.toFixed(2)])}
            />
          }
        >
          <HookCliffScatter promos={promos} onSelect={s.showPromo} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <ChartCard
          title="Candidate funnel"
          subtitle="From every clip considered to the post-first shortlist (whole run)"
          table={<SimpleTable head={["Stage", "Count", "Note"]} rows={funnelRows.map((r) => [r.label, r.value, r.note])} />}
        >
          <HBars rows={funnelRows} max={funnelRows[0]?.value} tone="navy" />
        </ChartCard>
        <ChartCard
          title="Most common editor warnings"
          subtitle="How many promos in view carry each warning"
          table={<SimpleTable head={["Warning", "Promos"]} rows={warnings.map((w) => [w.label, w.value])} />}
        >
          <HBars rows={warnings.map((w) => ({ ...w, label: w.label.charAt(0).toUpperCase() + w.label.slice(1) }))} max={promos.length || 1} tone="amber" />
        </ChartCard>
      </div>

      <ChartCard
        title="Clip length"
        subtitle="Seconds, in 5-second bands. Every promo is between 20 and 60 s by construction."
        legend={<Legend items={allKinds} />}
        table={<SimpleTable head={["Seconds", "Post first", "Recommended", "Weak"]} rows={durBins.map((b) => [`${b.lo}–${b.hi}`, b.headline, b.recommended, b.weak])} />}
      >
        <StackedHistogram bins={durBins} formatBin={(lo, hi) => `${lo}–${hi} s`} height={190} ariaLabel="Histogram of clip lengths" />
      </ChartCard>

      {compare && (
        <Card title="AI vs rule-based baseline" subtitle="Same pack, same validation. Scores are not on the same footing: AI scores are model judgments, rule scores are estimates.">
          <div className="px-3 py-3">
            <SimpleTable
              head={["Metric", "AI", "Rules only"]}
              rows={[
                ["Recommended", compare.ai.recommended, compare.h.recommended],
                ["Episodes with a recommended promo", `${compare.ai.episodesWithRecommended}/${compare.ai.episodesTotal}`, `${compare.h.episodesWithRecommended}/${compare.h.episodesTotal}`],
                ["Hook pass rate", `${compare.ai.hookPassRate}%`, `${compare.h.hookPassRate}%`],
                ["Cliffhanger pass rate", `${compare.ai.cliffhangerPassRate}%`, `${compare.h.cliffhangerPassRate}%`],
              ]}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
