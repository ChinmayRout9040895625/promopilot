/**
 * The shared pipeline. Runs identically in the browser (executors call API routes) and in the
 * CLI (executors call providers directly). It never imports provider SDKs itself.
 */
import type { Candidate, Decision, Episode, Evaluation, Promo, RawLlmRecord, RunResult } from "./types";
import { heuristicCandidates, heuristicEvaluate } from "./heuristic";
import { validateCandidate } from "./validate";
import { dedupe, overlapRatio } from "./dedupe";
import { statusFor, weakReasons } from "./score";
import { DEFAULT_RANK_OPTIONS, rankPromos, arcOf, type RankOptions } from "./rank";
import { StageError, type ProposedCandidates, type StageOutcome } from "./stages";
import { PROMPT_VERSION } from "./ai/prompts";

export const PIPELINE_VERSION = "1.0.0";

export interface Executors {
  propose?: (ep: Episode) => Promise<StageOutcome<ProposedCandidates>>;
  judge?: (candidates: Candidate[], episodes: Map<number, Episode>) => Promise<StageOutcome<Map<string, Evaluation>>>;
  stitch?: (sources: Candidate[], episodes: Map<number, Episode>) => Promise<StageOutcome<ProposedCandidates>>;
}

export type Phase = "heuristic" | "propose" | "judge" | "stitch" | "rank" | "done";

export interface ProgressEvent {
  phase: Phase;
  done: number;
  total: number;
  message: string;
  episode?: number;
  failed?: boolean;
}

export interface PipelineOptions {
  provider: string;
  model: string;
  heuristicPerEpisode?: number;
  judgeBatchSize?: number;
  concurrency?: number;
  stitch?: boolean;
  /** Minimum improvement (0-10 scale) a stitched promo needs over the best overlapping single clip. */
  stitchMargin?: number;
  rank?: Partial<RankOptions>;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runPipeline(episodesIn: Episode[], exec: Executors, opts: PipelineOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const aiMode = Boolean(exec.propose && exec.judge);
  const episodes = new Map(episodesIn.map((e) => [e.number, e]));
  const progress = opts.onProgress ?? (() => {});
  const concurrency = opts.concurrency ?? 3;
  const batchSize = opts.judgeBatchSize ?? 4;
  const perEp = opts.heuristicPerEpisode ?? (aiMode ? 2 : 3);
  const rankOpts = { ...DEFAULT_RANK_OPTIONS, ...opts.rank };
  const decisions: Decision[] = [];
  const rawLlm: RawLlmRecord[] = [];
  const notes: string[] = [];
  const failedEpisodes = new Set<number>();
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new Error("Run cancelled");
  };

  // 1. Heuristic baseline candidates (always).
  const heuristicEval = new Map<string, Evaluation>();
  const pool: Candidate[] = [];
  episodesIn.forEach((ep, i) => {
    for (const h of heuristicCandidates(ep, perEp)) {
      pool.push(h.candidate);
      heuristicEval.set(h.candidate.id, h.evaluation);
    }
    progress({ phase: "heuristic", done: i + 1, total: episodesIn.length, message: `Scanned episode ${ep.number}`, episode: ep.number });
  });

  // 2. AI proposals, one call per episode.
  if (exec.propose) {
    let done = 0;
    await mapLimit(episodesIn, concurrency, async (ep) => {
      checkAbort();
      try {
        const r = await exec.propose!(ep);
        rawLlm.push(r.record);
        pool.push(...r.value.candidates);
        decisions.push(...r.value.decisions);
        progress({ phase: "propose", done: ++done, total: episodesIn.length, message: `Episode ${ep.number}: ${r.value.candidates.length} AI proposal(s)`, episode: ep.number });
      } catch (e) {
        failedEpisodes.add(ep.number);
        if (e instanceof StageError) rawLlm.push(e.record);
        progress({ phase: "propose", done: ++done, total: episodesIn.length, message: `Episode ${ep.number}: AI proposal failed (${(e as Error).message}); heuristic candidates kept`, episode: ep.number, failed: true });
      }
    });
    if (failedEpisodes.size) notes.push(`AI proposal failed for episode(s) ${[...failedEpisodes].sort((a, b) => a - b).join(", ")}; heuristic candidates were used for them.`);
  }

  // 3. Deterministic validation of every candidate.
  const valid: Candidate[] = [];
  const validationWarnings = new Map<string, string[]>();
  for (const c of pool) {
    const v = validateCandidate(c, episodes);
    if (!v.ok) {
      decisions.push({ candidateId: c.id, status: "rejected", reasons: v.reasons });
      continue;
    }
    valid.push(c);
    validationWarnings.set(c.id, v.warnings);
  }

  // 4. Pre-judge dedupe of near-identical windows (AI proposals win ties) to save judge calls.
  const pre = dedupe(
    valid.map((c) => ({ candidate: c, score: c.source === "ai" ? 1000 : heuristicEval.get(c.id)?.overall ?? 0 })),
    0.8,
  );
  for (const d of pre.dropped) {
    decisions.push({ candidateId: d.item.candidate.id, status: "rejected", reasons: [`near-identical to ${d.duplicateOf} (overlap ${d.overlap}); merged before judging`] });
  }
  const toJudge = pre.kept.map((k) => k.candidate);

  // 5. Evaluate: AI judge in batches, heuristic fallback per candidate.
  const evals = new Map<string, Evaluation>();
  const evalNotes = new Map<string, string>();
  if (exec.judge) {
    const batches = chunk(toJudge, batchSize);
    let done = 0;
    await mapLimit(batches, concurrency, async (batch) => {
      checkAbort();
      try {
        const r = await exec.judge!(batch, episodes);
        rawLlm.push(r.record);
        for (const [id, ev] of r.value) evals.set(id, ev);
        for (const c of batch) if (!r.value.has(c.id)) evalNotes.set(c.id, "AI judge returned no evaluation for this clip; heuristic estimate shown");
        progress({ phase: "judge", done: ++done, total: batches.length, message: `Judged batch ${done}/${batches.length}` });
      } catch (e) {
        if (e instanceof StageError) rawLlm.push(e.record);
        for (const c of batch) evalNotes.set(c.id, `AI judge failed (${(e as Error).message}); heuristic estimate shown`);
        progress({ phase: "judge", done: ++done, total: batches.length, message: `Judge batch ${done} failed; using heuristic estimates`, failed: true });
      }
    });
  }
  const evaluationFor = (c: Candidate): Evaluation => {
    const ev = evals.get(c.id);
    if (ev) return ev;
    const h = heuristicEval.get(c.id);
    if (h) return h;
    const seg = c.segments[0];
    return heuristicEvaluate(episodes.get(seg.episode)!, seg);
  };

  const promos: Promo[] = toJudge.map((c) => buildPromo(c, evaluationFor(c), validationWarnings.get(c.id) ?? [], evalNotes.get(c.id), rankOpts.arcSize));

  // 6. Optional multi-segment stitching, only on AI-judged single clips.
  if (opts.stitch && exec.stitch && exec.judge) {
    checkAbort();
    await stitchStage(promos, episodes, exec, opts, decisions, rawLlm, notes, rankOpts.arcSize, progress);
  }

  // 7. Final dedupe (overlap >= 50%): recommended promos and higher scores win.
  const finalDedupe = dedupe(promos.map((p) => ({ candidate: p.candidate, score: p.evaluation.overall + (p.status === "recommended" ? 100 : 0), promo: p })));
  for (const d of finalDedupe.dropped) {
    decisions.push({ candidateId: d.item.candidate.id, status: "rejected", reasons: [`near-duplicate of ${d.duplicateOf} (overlap ${d.overlap}) with a lower score`] });
  }
  const kept = finalDedupe.kept.map((k) => k.promo);
  for (const p of kept) {
    decisions.push({
      candidateId: p.candidate.id,
      status: "accepted",
      reasons: [p.status === "recommended" ? "passed validation and quality gates" : `kept as weak: ${weakReasons(p.evaluation).join("; ") || "below gate"}`],
    });
  }

  progress({ phase: "rank", done: 1, total: 1, message: "Ranking promos" });
  const ranked = rankPromos(kept, rankOpts);
  progress({ phase: "done", done: 1, total: 1, message: `Done: ${ranked.filter((p) => p.status === "recommended").length} recommended promos` });

  return {
    meta: {
      pipelineVersion: PIPELINE_VERSION,
      promptVersion: PROMPT_VERSION,
      mode: aiMode ? "ai" : "heuristic",
      provider: aiMode ? opts.provider : "none",
      model: aiMode ? opts.model : "none",
      startedAt,
      finishedAt: new Date().toISOString(),
      episodesParsed: episodesIn.length,
      episodesFailed: [...failedEpisodes].sort((a, b) => a - b),
      notes,
    },
    promos: ranked,
    decisions,
    candidatesConsidered: pool.length,
    rawLlm,
  };
}

export function buildPromo(c: Candidate, ev: Evaluation, validationWarnings: string[], note: string | undefined, arcSize: number): Promo {
  const { status, warnings } = statusFor(ev);
  const all = [...validationWarnings, ...warnings];
  if (ev.scoreSource === "heuristic") all.unshift("Heuristic estimate (no AI analysis): requires human review");
  if (note) all.unshift(note);
  return {
    id: c.id,
    rank: 0,
    status,
    candidate: c,
    evaluation: ev,
    warnings: [...new Set(all)],
    headline: false,
    arc: arcOf(c.segments[0].episode, arcSize),
  };
}

async function stitchStage(
  promos: Promo[],
  episodes: Map<number, Episode>,
  exec: Executors,
  opts: PipelineOptions,
  decisions: Decision[],
  rawLlm: RawLlmRecord[],
  notes: string[],
  arcSize: number,
  progress: (e: ProgressEvent) => void,
) {
  const margin = opts.stitchMargin ?? 0.5;
  const sources = promos
    .filter((p) => p.evaluation.scoreSource === "ai" && p.status === "recommended" && p.candidate.segments.length === 1)
    .sort((a, b) => b.evaluation.overall - a.evaluation.overall)
    .slice(0, 20)
    .map((p) => p.candidate);
  if (sources.length < 2) {
    notes.push("Stitching skipped: fewer than two AI-judged recommended clips.");
    return;
  }
  progress({ phase: "stitch", done: 0, total: 2, message: "Looking for multi-segment promos" });
  let proposed: ProposedCandidates;
  try {
    const r = await exec.stitch!(sources, episodes);
    rawLlm.push(r.record);
    proposed = r.value;
  } catch (e) {
    if (e instanceof StageError) rawLlm.push(e.record);
    notes.push(`Stitching failed: ${(e as Error).message}`);
    return;
  }
  decisions.push(...proposed.decisions);
  const valid: Candidate[] = [];
  const vWarn = new Map<string, string[]>();
  for (const c of proposed.candidates) {
    const v = validateCandidate(c, episodes);
    if (!v.ok) decisions.push({ candidateId: c.id, status: "rejected", reasons: v.reasons });
    else {
      valid.push(c);
      vWarn.set(c.id, v.warnings);
    }
  }
  if (!valid.length) {
    progress({ phase: "stitch", done: 2, total: 2, message: "No valid multi-segment promos" });
    return;
  }
  let judged: Map<string, Evaluation>;
  try {
    const r = await exec.judge!(valid, episodes);
    rawLlm.push(r.record);
    judged = r.value;
  } catch (e) {
    if (e instanceof StageError) rawLlm.push(e.record);
    notes.push(`Stitched promos could not be judged: ${(e as Error).message}`);
    return;
  }
  for (const c of valid) {
    const ev = judged.get(c.id);
    if (!ev) {
      decisions.push({ candidateId: c.id, status: "rejected", reasons: ["stitched promo was not judged"] });
      continue;
    }
    // Comparator: the best judged single-segment clip covering any of the same material.
    const comparable = promos.filter((p) => p.candidate.segments.length === 1 && overlapRatio(p.candidate, c) > 0);
    const best = Math.max(...comparable.map((p) => p.evaluation.overall), -Infinity);
    if (!Number.isFinite(best)) {
      decisions.push({ candidateId: c.id, status: "rejected", reasons: ["no comparable single-segment clip to beat"] });
      continue;
    }
    if (ev.overall < best + margin) {
      decisions.push({
        candidateId: c.id,
        status: "rejected",
        reasons: [`continuous alternative stronger: stitched ${ev.overall} vs best single ${best} (needs +${margin})`],
      });
      continue;
    }
    promos.push(buildPromo(c, ev, vWarn.get(c.id) ?? [], `Multi-segment: beats best single clip (${best}) by ${(ev.overall - best).toFixed(2)}`, arcSize));
  }
  progress({ phase: "stitch", done: 2, total: 2, message: "Stitching complete" });
}
