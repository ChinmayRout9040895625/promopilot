/**
 * Read-only views over a RunResult for the dashboard. Nothing here changes scores, ranks or
 * timestamps; it only groups and counts what the pipeline produced.
 */
import type { Decision, Episode, Promo, RunResult } from "@/core/types";
import { reasonClass } from "@/core/export";
import type { PromoFilter } from "@/components/app/store";

export type PromoKind = "headline" | "recommended" | "weak";
export const kindOf = (p: Promo): PromoKind => (p.headline ? "headline" : p.status === "recommended" ? "recommended" : "weak");
export const KIND_LABEL: Record<PromoKind, string> = { headline: "Post first", recommended: "Recommended", weak: "Weak" };
export const KIND_COLOR: Record<PromoKind | "none", string> = { headline: "var(--c-post)", recommended: "var(--c-rec)", weak: "var(--c-weak)", none: "var(--c-none)" };

export const epLabel = (p: Promo) => [...new Set(p.candidate.segments.map((s) => s.episode))].map((e) => `E${e}`).join(" + ");
export const timeLabel = (p: Promo) => p.candidate.segments.map((s) => `${s.startTc}–${s.endTc}`).join(" + ");
export const secs = (cs: number) => `${(cs / 100).toFixed(1)} s`;

// ---------------------------------------------------------------- filtering / sorting

export function filterPromos(promos: Promo[], f: PromoFilter, arcSize = 10): Promo[] {
  const q = f.query.trim().toLowerCase();
  const epQuery = /^e?(\d{1,3})$/i.exec(q);
  let out = promos.filter((p) => {
    const k = kindOf(p);
    if (f.status === "headline" && k !== "headline") return false;
    if (f.status === "recommended" && k === "weak") return false;
    if (f.status === "weak" && k !== "weak") return false;
    if (f.source !== "all" && p.candidate.source !== f.source) return false;
    const eps = p.candidate.segments.map((s) => s.episode);
    if (f.arc && !eps.some((e) => Math.ceil(e / arcSize) === f.arc)) return false;
    if (f.episode && !eps.includes(f.episode)) return false;
    if (p.evaluation.overall < f.minScore) return false;
    if (q) {
      if (epQuery) return eps.includes(Number(epQuery[1]));
      const hay = [p.id, p.evaluation.hook, p.evaluation.cliffhanger, p.evaluation.whyItWorks, p.rankReason ?? "", p.candidate.pitch ?? "", ...p.warnings]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by: Record<PromoFilter["sort"], (a: Promo, b: Promo) => number> = {
    rank: (a, b) => a.rank - b.rank,
    overall: (a, b) => b.evaluation.overall - a.evaluation.overall || a.rank - b.rank,
    hook: (a, b) => b.evaluation.scores.hook - a.evaluation.scores.hook || a.rank - b.rank,
    cliffhanger: (a, b) => b.evaluation.scores.cliffhanger - a.evaluation.scores.cliffhanger || a.rank - b.rank,
    standalone: (a, b) => b.evaluation.scores.standalone - a.evaluation.scores.standalone || a.rank - b.rank,
    duration: (a, b) => a.candidate.durationCs - b.candidate.durationCs || a.rank - b.rank,
    episode: (a, b) => a.candidate.segments[0].episode - b.candidate.segments[0].episode || a.candidate.segments[0].startCs - b.candidate.segments[0].startCs,
  };
  out = [...out].sort(by[f.sort]);
  return out;
}

// ---------------------------------------------------------------- per-episode coverage

export interface EpisodeStat {
  episode: number;
  durationCs: number;
  promos: number;
  best: Promo | null;
  kind: PromoKind | "none";
  headline: number;
  recommended: number;
  weak: number;
}

export function episodeStats(run: RunResult, episodes: Episode[]): EpisodeStat[] {
  return episodes.map((ep) => {
    const ps = run.promos.filter((p) => p.candidate.segments.some((s) => s.episode === ep.number));
    const ranked = [...ps].sort((a, b) => {
      const order = { headline: 0, recommended: 1, weak: 2 } as const;
      return order[kindOf(a)] - order[kindOf(b)] || b.evaluation.overall - a.evaluation.overall;
    });
    const best = ranked[0] ?? null;
    return {
      episode: ep.number,
      durationCs: ep.durationCs,
      promos: ps.length,
      best,
      kind: best ? kindOf(best) : "none",
      headline: ps.filter((p) => p.headline).length,
      recommended: ps.filter((p) => kindOf(p) === "recommended").length,
      weak: ps.filter((p) => kindOf(p) === "weak").length,
    };
  });
}

// ---------------------------------------------------------------- distributions

export function histogram(promos: Promo[], value: (p: Promo) => number, edges: number[]) {
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const last = i === edges.length - 2;
    const inBin = promos.filter((p) => {
      const v = value(p);
      return v >= lo && (last ? v <= hi : v < hi);
    });
    return {
      lo,
      hi,
      headline: inBin.filter((p) => kindOf(p) === "headline").length,
      recommended: inBin.filter((p) => kindOf(p) === "recommended").length,
      weak: inBin.filter((p) => kindOf(p) === "weak").length,
    };
  });
}

// ---------------------------------------------------------------- candidates

export interface CandidateRow {
  candidateId: string;
  source: "AI" | "Rule" | "Stitch" | "Other";
  episode: number | null;
  outcome: "post-first" | "recommended" | "weak" | "rejected";
  category: string;
  reasons: string[];
  promo?: Promo;
}

export function candidateRows(run: RunResult): CandidateRow[] {
  const latest = new Map<string, Decision>();
  for (const d of run.decisions) latest.set(d.candidateId, d);
  const byCand = new Map(run.promos.map((p) => [p.candidate.id, p]));
  return [...latest.values()].map((d) => {
    const id = d.candidateId;
    const source = id.startsWith("A-") ? "AI" : id.startsWith("H-") ? "Rule" : id.startsWith("S-") ? "Stitch" : "Other";
    const m = /E(\d+)/.exec(id);
    const promo = byCand.get(id);
    const outcome: CandidateRow["outcome"] =
      d.status === "rejected" || !promo ? "rejected" : promo.headline ? "post-first" : promo.status === "recommended" ? "recommended" : "weak";
    const category = d.status === "rejected" ? reasonClass(d.reasons[0] ?? "") : outcome === "weak" ? "failed a quality gate" : "passed";
    return { candidateId: id, source, episode: m ? Number(m[1]) : promo?.candidate.segments[0].episode ?? null, outcome, category, reasons: d.reasons, promo };
  });
}

/** Funnel stages from the decision log (counts only). */
export function funnel(run: RunResult) {
  const rows = candidateRows(run);
  const total = rows.length;
  const invalid = rows.filter((r) => r.outcome === "rejected" && /invalid|duration|timestamp/.test(r.category)).length;
  const dup = rows.filter((r) => r.outcome === "rejected" && r.category === "duplicate").length;
  const stitch = rows.filter((r) => r.outcome === "rejected" && r.category.startsWith("stitch")).length;
  const other = rows.filter((r) => r.outcome === "rejected").length - invalid - dup - stitch;
  const accepted = run.promos.length;
  const recommended = run.promos.filter((p) => p.status === "recommended").length;
  const headline = run.promos.filter((p) => p.headline).length;
  return [
    { label: "Candidates generated", value: total, note: "AI proposals, rule-based windows and stitched combinations" },
    { label: "Passed timestamp & duration checks", value: total - invalid, note: `${invalid} rejected: invalid beat IDs, cut lines, or outside 20–60 s` },
    { label: "Unique after dedupe", value: total - invalid - dup, note: `${dup} near-duplicates merged` },
    { label: "Accepted promos", value: accepted, note: `${stitch + other} more rejected (stitches that lost to a continuous clip, or other)` },
    { label: "Recommended", value: recommended, note: "pass hook, cliffhanger and standalone checks" },
    { label: "Post first", value: headline, note: "best under the diversity rules" },
  ];
}

export function warningCounts(run: RunResult, top = 8) {
  const counts = new Map<string, number>();
  for (const p of run.promos) {
    for (const w of new Set(
      p.warnings.map((x) =>
        x
          .replace(/^segment \d+:\s*/i, "")
          .replace(/\(.*?\)/g, "")
          .replace(/:.*$/, "")
          .trim(),
      ),
    ))
      counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([label, value]) => ({ label, value }));
}
