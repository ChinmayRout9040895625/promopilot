"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/components/app/store";
import { Badge, Button, Card, EmptyState, Icon, Segmented, Select } from "@/components/app/ui";
import { candidateRows, type CandidateRow } from "@/lib/derive";

type Outcome = "all" | "accepted" | "rejected";
type SortKey = "candidate" | "episode" | "outcome" | "score";

const outcomeBadge: Record<CandidateRow["outcome"], { tone: "navy" | "teal" | "amber" | "neutral"; label: string }> = {
  "post-first": { tone: "navy", label: "◆ Post first" },
  recommended: { tone: "teal", label: "● Recommended" },
  weak: { tone: "amber", label: "▲ Weak" },
  rejected: { tone: "neutral", label: "✕ Rejected" },
};

const PAGE = 50;

export default function Candidates() {
  const s = useStore();
  const run = s.run;
  const rows = useMemo(() => (run ? candidateRows(run) : []), [run]);
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "candidate", dir: 1 });
  const [limit, setLimit] = useState(PAGE);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (outcome === "accepted" && r.outcome === "rejected") return false;
      if (outcome === "rejected" && r.outcome !== "rejected") return false;
      if (category !== "all" && r.category !== category) return false;
      if (source !== "all" && r.source !== source) return false;
      if (q && !`${r.candidateId} ${r.reasons.join(" ")} e${r.episode ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const rankOf = { "post-first": 0, recommended: 1, weak: 2, rejected: 3 };
    const cmp: Record<SortKey, (a: CandidateRow, b: CandidateRow) => number> = {
      candidate: (a, b) => a.candidateId.localeCompare(b.candidateId, undefined, { numeric: true }),
      episode: (a, b) => (a.episode ?? 999) - (b.episode ?? 999) || a.candidateId.localeCompare(b.candidateId, undefined, { numeric: true }),
      outcome: (a, b) => rankOf[a.outcome] - rankOf[b.outcome] || (b.promo?.evaluation.overall ?? 0) - (a.promo?.evaluation.overall ?? 0),
      score: (a, b) => (b.promo?.evaluation.overall ?? -1) - (a.promo?.evaluation.overall ?? -1),
    };
    return out.sort((a, b) => cmp[sort.key](a, b) * sort.dir);
  }, [rows, outcome, category, source, query, sort]);

  if (!run) {
    return (
      <Card>
        <EmptyState icon="candidates" title="No candidates yet" action={<Button variant="primary" onClick={() => s.navigate("overview")}>Go to Overview</Button>}>
          Every clip the pipeline considered appears here with the reason it was accepted or rejected.
        </EmptyState>
      </Card>
    );
  }

  const acceptedCount = rows.filter((r) => r.outcome !== "rejected").length;
  const header = (key: SortKey, label: string, cls = "") => (
    <th scope="col" className={`px-3 py-2 font-medium ${cls}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((o) => ({ key, dir: o.key === key ? ((o.dir * -1) as 1 | -1) : 1 }))}>
        {label}
        {sort.key === key && <Icon name={sort.dir === 1 ? "chevronUp" : "chevronDown"} size={12} />}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">All candidates</h1>
        <p className="mt-0.5 text-sm text-muted">
          The decision log: every clip considered, and why it was kept or dropped. {rows.length} candidates, {acceptedCount} accepted.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search candidates</span>
          <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search IDs or reasons, e.g. duplicate, E12"
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-subtle"
          />
        </label>
        <Segmented<Outcome>
          label="Outcome"
          value={outcome}
          onChange={(v) => {
            setOutcome(v);
            setLimit(PAGE);
          }}
          options={[
            { value: "all", label: "All", count: rows.length },
            { value: "accepted", label: "Accepted", count: acceptedCount },
            { value: "rejected", label: "Rejected", count: rows.length - acceptedCount },
          ]}
        />
        <Select label="Reason" value={category} onChange={setCategory} options={[{ value: "all", label: "All reasons" }, ...categories.map((c) => ({ value: c, label: c }))]} />
        <Select
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "All sources" },
            { value: "AI", label: "AI-proposed" },
            { value: "Rule", label: "Rule-based" },
            { value: "Stitch", label: "Multi-segment" },
          ]}
        />
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState icon="search" title="No candidates match">
            Clear the search or choose another outcome.
          </EmptyState>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                <tr>
                  {header("candidate", "Candidate")}
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  {header("episode", "Episode")}
                  {header("outcome", "Outcome")}
                  {header("score", "Score", "text-right")}
                  <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.slice(0, limit).map((r) => {
                  const b = outcomeBadge[r.outcome];
                  return (
                    <tr key={r.candidateId} className="align-top hover:bg-surface-2">
                      <td className="px-3 py-2.5">
                        {r.promo ? (
                          <button type="button" onClick={() => s.showPromo(r.promo!.id)} className="font-mono text-[12px] font-medium text-navy underline-offset-2 hover:underline">
                            {r.candidateId}
                          </button>
                        ) : (
                          <span className="font-mono text-[12px] text-ink-2">{r.candidateId}</span>
                        )}
                        {r.promo && <span className="tc ml-2 text-xs text-subtle">#{r.promo.rank}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{r.source}</td>
                      <td className="tc px-3 py-2.5 text-ink-2">{r.episode ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={b.tone}>{b.label}</Badge>
                      </td>
                      <td className="tc px-3 py-2.5 text-right font-medium text-ink">{r.promo ? r.promo.evaluation.overall.toFixed(2) : "—"}</td>
                      <td className="max-w-[520px] px-3 py-2.5 text-ink-2">
                        <span className="text-xs font-medium text-muted">{r.category}. </span>
                        {r.promo?.rankReason ?? r.reasons.join("; ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > limit && (
          <div className="border-t border-line px-4 py-3 text-center">
            <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
