import type { Decision, Promo, RunResult } from "./types";
import { formatSeconds } from "./timecode";
import { overlapRatio } from "./dedupe";
import { GATE, WEIGHTS } from "./score";

// ---------------------------------------------------------------- JSON

/** Full machine-readable run. Raw LLM text is excluded unless asked for (it can be large). */
export function toJson(run: RunResult, opts: { includeRaw?: boolean } = {}): string {
  const { rawLlm, ...rest } = run;
  const body = {
    ...rest,
    scoring: { weights: WEIGHTS, gate: GATE, scale: "0-10" },
    promos: run.promos.map(promoView),
    ...(opts.includeRaw ? { rawLlm } : { rawLlmCalls: rawLlm.length }),
  };
  return JSON.stringify(body, null, 2);
}

export function promoView(p: Promo) {
  return {
    promoId: p.id,
    rank: p.rank,
    headline: p.headline,
    status: p.status,
    rankReason: p.rankReason ?? "",
    source: p.candidate.source,
    candidateId: p.candidate.id,
    arc: p.arc,
    totalDuration: formatSeconds(p.candidate.durationCs),
    totalDurationCs: p.candidate.durationCs,
    segments: p.candidate.segments.map((s, i) => ({
      order: i + 1,
      episode: s.episode,
      start: s.startTc,
      end: s.endTc,
      duration: formatSeconds(s.endCs - s.startCs),
      startBeatId: s.startBeatId,
      endBeatId: s.endBeatId,
    })),
    scoreSource: p.evaluation.scoreSource,
    overall: p.evaluation.overall,
    scores: p.evaluation.scores,
    hook: p.evaluation.hook,
    cliffhanger: p.evaluation.cliffhanger,
    whyItWorks: p.evaluation.whyItWorks,
    openingInteresting: p.evaluation.openingInteresting,
    endingCreatesCuriosity: p.evaluation.endingCreatesCuriosity,
    endingResolved: p.evaluation.endingResolved,
    makesSenseAlone: p.evaluation.makesSenseAlone,
    confusingReferences: p.evaluation.confusingReferences,
    confidence: p.evaluation.confidence,
    concerns: p.evaluation.concerns,
    warnings: p.warnings,
    proposerPitch: p.candidate.pitch,
  };
}

// ---------------------------------------------------------------- CSV

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "rank", "promo_id", "headline", "status", "rank_reason", "segment", "segment_count", "episode", "start", "end", "segment_duration_s",
  "total_duration_s", "overall", "hook_score", "cliffhanger_score", "standalone_score", "intensity_score", "appeal_score",
  "score_source", "hook", "cliffhanger", "why_it_works", "warnings", "mode", "provider", "model",
] as const;

/** One row per segment, so editors can cut directly from the sheet. */
export function toCsv(run: RunResult): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];
  for (const p of run.promos) {
    p.candidate.segments.forEach((s, i) => {
      const e = p.evaluation;
      const row = [
        p.rank, p.id, p.headline ? "yes" : "no", p.status, p.rankReason ?? "", i + 1, p.candidate.segments.length, s.episode, s.startTc, s.endTc,
        ((s.endCs - s.startCs) / 100).toFixed(2), (p.candidate.durationCs / 100).toFixed(2), e.overall.toFixed(2),
        e.scores.hook, e.scores.cliffhanger, e.scores.standalone, e.scores.intensity, e.scores.appeal, e.scoreSource,
        e.hook, e.cliffhanger, e.whyItWorks, p.warnings.join(" | "), run.meta.mode, run.meta.provider, run.meta.model,
      ];
      rows.push(row.map(csvEscape).join(","));
    });
  }
  return rows.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Metrics

export interface Metrics {
  candidatesConsidered: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number;
  rejectionReasons: Record<string, number>;
  duplicateRate: number;
  recommended: number;
  weak: number;
  hookPassRate: number;
  cliffhangerPassRate: number;
  bothPassRate: number;
  episodesTotal: number;
  episodesWithRecommended: number;
  episodesInHeadline: number;
  headlineByArc: Record<string, number>;
  bySource: Record<string, { count: number; meanOverall: number; recommended: number }>;
  meanOverall: number;
  warningCounts: Record<string, number>;
}

export function reasonClass(r: string): string {
  if (/invalid beat reference|end beat precedes|could not form/.test(r)) return "invalid AI beat reference";
  if (/near-identical|near-duplicate/.test(r)) return "duplicate";
  if (/too short|too long/.test(r)) return "duration outside 20-60 s";
  if (/continuous alternative stronger|no comparable/.test(r)) return "stitch not better than continuous";
  if (/cuts .* in half|beat boundary|order|overlap|bounds|segment/.test(r)) return "timestamp/segment validation";
  return "other";
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function computeMetrics(run: RunResult): Metrics {
  const latest = new Map<string, Decision>();
  for (const d of run.decisions) latest.set(d.candidateId, d);
  const decisions = [...latest.values()];
  const accepted = decisions.filter((d) => d.status === "accepted").length;
  const rejectedDs = decisions.filter((d) => d.status === "rejected");
  const reasons: Record<string, number> = {};
  for (const d of rejectedDs) {
    const cls = reasonClass(d.reasons[0] ?? "");
    reasons[cls] = (reasons[cls] ?? 0) + 1;
  }
  const promos = run.promos;
  const eps = new Set<number>();
  const headEps = new Set<number>();
  const byArc: Record<string, number> = {};
  const bySource: Metrics["bySource"] = {};
  const warn: Record<string, number> = {};
  for (const p of promos) {
    const src = p.candidate.source;
    bySource[src] ??= { count: 0, meanOverall: 0, recommended: 0 };
    bySource[src].count++;
    bySource[src].meanOverall += p.evaluation.overall;
    if (p.status === "recommended") {
      bySource[src].recommended++;
      p.candidate.segments.forEach((s) => eps.add(s.episode));
    }
    if (p.headline) {
      p.candidate.segments.forEach((s) => headEps.add(s.episode));
      byArc[`arc ${p.arc}`] = (byArc[`arc ${p.arc}`] ?? 0) + 1;
    }
    for (const w of p.warnings) {
      const key = w
        .replace(/^segment \d+:\s*/i, "")
        .replace(/\(.*?\)/g, "")
        .replace(/:.*$/, "")
        .trim();
      warn[key] = (warn[key] ?? 0) + 1;
    }
  }
  for (const s of Object.values(bySource)) s.meanOverall = Math.round((s.meanOverall / s.count) * 100) / 100;
  const hookPass = promos.filter((p) => p.evaluation.scores.hook >= GATE).length;
  const cliffPass = promos.filter((p) => p.evaluation.scores.cliffhanger >= GATE).length;
  const both = promos.filter((p) => p.evaluation.scores.hook >= GATE && p.evaluation.scores.cliffhanger >= GATE).length;
  const dupes = reasons["duplicate"] ?? 0;
  return {
    candidatesConsidered: decisions.length,
    accepted,
    rejected: rejectedDs.length,
    acceptanceRate: pct(accepted, decisions.length),
    rejectionReasons: reasons,
    duplicateRate: pct(dupes, decisions.length),
    recommended: promos.filter((p) => p.status === "recommended").length,
    weak: promos.filter((p) => p.status === "weak").length,
    hookPassRate: pct(hookPass, promos.length),
    cliffhangerPassRate: pct(cliffPass, promos.length),
    bothPassRate: pct(both, promos.length),
    episodesTotal: run.meta.episodesParsed,
    episodesWithRecommended: eps.size,
    episodesInHeadline: headEps.size,
    headlineByArc: byArc,
    bySource,
    meanOverall: promos.length ? Math.round((promos.reduce((s, p) => s + p.evaluation.overall, 0) / promos.length) * 100) / 100 : 0,
    warningCounts: Object.fromEntries(Object.entries(warn).sort((a, b) => b[1] - a[1])),
  };
}

/** How many of A's headline promos have a heuristic-run headline covering the same material (overlap >= 50%). */
export function compareHeadlines(a: RunResult, b: RunResult): { aCount: number; bCount: number; matched: number; matchRate: number } {
  const ah = a.promos.filter((p) => p.headline);
  const bh = b.promos.filter((p) => p.headline);
  const matched = ah.filter((p) => bh.some((q) => overlapRatio(p.candidate, q.candidate) >= 0.5)).length;
  return { aCount: ah.length, bCount: bh.length, matched, matchRate: pct(matched, ah.length) };
}

// ---------------------------------------------------------------- Quality report (markdown)

function segText(p: Promo): string {
  return p.candidate.segments.map((s) => `E${s.episode} ${s.startTc}-${s.endTc}`).join(" + ");
}

const oneLine = (s: string, n = 110) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const mdCell = (s: string) => s.replace(/\|/g, "\\|");

export function qualityReport(run: RunResult, baseline?: RunResult): string {
  const m = computeMetrics(run);
  const L: string[] = [];
  L.push(`# PromoPilot AI quality report`, "");
  L.push(`- Mode: **${run.meta.mode}** (provider: ${run.meta.provider}, model: ${run.meta.model})`);
  L.push(`- Pipeline ${run.meta.pipelineVersion}, prompts ${run.meta.promptVersion}`);
  L.push(`- Run: ${run.meta.startedAt} to ${run.meta.finishedAt ?? "?"}`);
  L.push(`- Episodes parsed: ${run.meta.episodesParsed}${run.meta.episodesFailed.length ? `; AI failed for: ${run.meta.episodesFailed.join(", ")}` : ""}`);
  if (run.meta.mode === "heuristic") L.push(`- **Heuristic mode: no AI analysis was performed. All scores are rule-based estimates and every promo needs human review.**`);
  for (const n of run.meta.notes) L.push(`- Note: ${n}`);
  L.push("", "## Candidate funnel", "");
  L.push(`| Metric | Value |`, `|---|---|`);
  L.push(`| Candidates considered | ${m.candidatesConsidered} |`);
  L.push(`| Accepted | ${m.accepted} (${m.acceptanceRate}%) |`);
  L.push(`| Rejected | ${m.rejected} (${Math.round((100 - m.acceptanceRate) * 10) / 10}%) |`);
  L.push(`| Duplicate rate | ${m.duplicateRate}% of candidates |`);
  L.push(`| Recommended / weak | ${m.recommended} / ${m.weak} |`);
  L.push(`| Hook pass rate (score >= ${GATE}) | ${m.hookPassRate}% |`);
  L.push(`| Cliffhanger pass rate (score >= ${GATE}) | ${m.cliffhangerPassRate}% |`);
  L.push(`| Both pass | ${m.bothPassRate}% |`);
  L.push(`| Mean overall score | ${m.meanOverall} |`);
  L.push(`| Episodes with a recommended promo | ${m.episodesWithRecommended} / ${m.episodesTotal} |`);
  L.push(`| Episodes in headline list | ${m.episodesInHeadline} |`);
  L.push("", "Rejection reasons:", "");
  for (const [k, v] of Object.entries(m.rejectionReasons)) L.push(`- ${k}: ${v}`);
  L.push("", "Headline promos per story arc (arc = 10-episode block):", "");
  for (const [k, v] of Object.entries(m.headlineByArc).sort()) L.push(`- ${k}: ${v}`);
  L.push("", "By candidate source:", "");
  L.push(`| Source | Accepted | Recommended | Mean overall |`, `|---|---|---|---|`);
  for (const [k, v] of Object.entries(m.bySource)) L.push(`| ${k} | ${v.count} | ${v.recommended} | ${v.meanOverall} |`);
  L.push("", "Most common warnings:", "");
  for (const [k, v] of Object.entries(m.warningCounts).slice(0, 10)) L.push(`- ${k}: ${v}`);

  if (baseline) {
    const c = compareHeadlines(run, baseline);
    L.push("", "## AI versus heuristic baseline", "");
    L.push(`${c.matched} of ${c.aCount} headline promos in this run (${c.matchRate}%) overlap a headline promo from the ${baseline.meta.mode} run by at least 50%.`);
    const bm = computeMetrics(baseline);
    L.push("", `| Metric | This run (${run.meta.mode}) | Baseline (${baseline.meta.mode}) |`, `|---|---|---|`);
    L.push(`| Recommended | ${m.recommended} | ${bm.recommended} |`);
    L.push(`| Hook pass rate | ${m.hookPassRate}% | ${bm.hookPassRate}% |`);
    L.push(`| Cliffhanger pass rate | ${m.cliffhangerPassRate}% | ${bm.cliffhangerPassRate}% |`);
    L.push(`| Episodes with recommended | ${m.episodesWithRecommended} | ${bm.episodesWithRecommended} |`);
    L.push("", "Scores from the two modes are not on the same footing: AI scores are model judgments, heuristic scores are rule-based estimates.");
  }

  const head = run.promos.filter((p) => p.headline);
  L.push("", "## Why these are posted first", "");
  L.push(
    "Order rule: recommended promos (hook, cliffhanger and standalone sense all pass) rank above weak ones, by overall score. " +
      "The post-first list then takes them in that order but allows at most 2 per episode, 4 per 10-episode arc, and no clip that runs on from an earlier pick in the same episode. " +
      "Overall = 25% hook + 25% cliffhanger + 20% standalone + 15% intensity + 15% appeal.",
    "",
  );
  L.push(`| Rank | Segments | Score | Why this rank | Why it works |`, `|---|---|---|---|---|`);
  for (const p of head) {
    L.push(`| ${p.rank} | ${segText(p)} | ${p.evaluation.overall.toFixed(2)} | ${mdCell(oneLine(p.rankReason ?? "", 160))} | ${mdCell(oneLine(p.evaluation.whyItWorks, 140))} |`);
  }
  const held = run.promos.filter((p) => !p.headline && p.status === "recommended" && p.evaluation.overall >= (head.at(-1)?.evaluation.overall ?? Infinity));
  if (held.length) {
    L.push("", `Held back despite scoring at least as high as the last post-first pick (${held.length}):`, "");
    for (const p of held) L.push(`- #${p.rank} ${segText(p)} (${p.evaluation.overall.toFixed(2)}): ${p.rankReason ?? ""}`);
  }

  const accepted = run.promos;
  const top = accepted.slice(0, 15);
  const bottom = accepted.slice(-5);
  const reviewTable = (ps: Promo[]) => {
    L.push(`| Rank | Status | Segments | Dur | Score | Hook | Cliffhanger | Verdict | Failure tag |`, `|---|---|---|---|---|---|---|---|---|`);
    for (const p of ps) {
      L.push(`| ${p.rank} | ${p.status} | ${segText(p)} | ${formatSeconds(p.candidate.durationCs)} | ${p.evaluation.overall} | ${mdCell(oneLine(p.evaluation.hook))} | ${mdCell(oneLine(p.evaluation.cliffhanger))} | _to review_ | |`);
    }
  };
  L.push("", "## Review sheet: top 15", "");
  L.push("Verdict: good / okay / bad. Failure tags: needs-context, resolved-ending, weak-opening, spoiler, near-duplicate, mid-action-cut.", "");
  reviewTable(top);
  L.push("", "## Review sheet: bottom 5 accepted", "");
  reviewTable(bottom);
  L.push("", "## Limitations of screenplay-only analysis", "");
  L.push("- The tool reads text, not video. Performance, pacing, music and visual impact are invisible to it.");
  L.push("- Screenplay timestamps are assumed to match the final edit; any drift in the real video shifts every cut.");
  L.push("- \"First 3 seconds\" is measured on screenplay time. A slow camera move written as one beat may still feel slow on screen.");
  L.push("- Character names change across episodes in some scripts (aliases); the judge may miss or over-flag confusing references.");
  L.push("- AI judges are lenient and not perfectly consistent; scores are a ranking aid, not ground truth.");
  return L.join("\n") + "\n";
}
