/**
 * Stage functions: one LLM call each. Used directly by the CLI and wrapped by the API routes,
 * so both paths share prompts, schemas, validation and ID-to-timestamp conversion.
 */
import type { Candidate, Decision, Episode, Evaluation, RawLlmRecord, Segment } from "./types";
import type { LlmProvider } from "./ai/provider";
import { callJson, LlmCallFailure, type CallOptions } from "./ai/json";
import { JudgeSchema, ProposeSchema, StitchSchema, type JudgeOutput } from "./ai/schemas";
import {
  JUDGE_SYSTEM,
  PROPOSE_SYSTEM,
  STITCH_SYSTEM,
  judgeUserPrompt,
  proposeUserPrompt,
  stitchUserPrompt,
} from "./ai/prompts";
import { getBeat } from "./parse";
import { snapSegment, totalDuration } from "./windows";
import { overallScore } from "./score";

export interface StageOutcome<T> {
  value: T;
  record: RawLlmRecord;
}

function record(
  stage: RawLlmRecord["stage"],
  provider: LlmProvider,
  extra: Partial<RawLlmRecord>,
): RawLlmRecord {
  return {
    stage,
    key: "",
    provider: provider.name,
    model: provider.model,
    rawText: "",
    ok: false,
    latencyMs: 0,
    cached: false,
    ...extra,
  };
}

async function call<S extends Parameters<typeof callJson>[1]["schema"]>(
  provider: LlmProvider,
  stage: RawLlmRecord["stage"],
  req: { system: string; user: string; schema: S; schemaName: string; maxTokens?: number },
  meta: Partial<RawLlmRecord>,
  opts?: CallOptions,
) {
  const t0 = Date.now();
  try {
    const r = await callJson(provider, { stage, ...req }, opts);
    return {
      data: r.data,
      record: record(stage, provider, {
        ...meta,
        key: r.cacheKey,
        rawText: r.rawText,
        ok: true,
        latencyMs: r.latencyMs,
        cached: r.cached,
        usage: r.usage,
        servedModel: r.servedModel,
      }),
    };
  } catch (e) {
    const f = e instanceof LlmCallFailure ? e : null;
    const rec = record(stage, provider, {
      ...meta,
      key: f?.cacheKey ?? "",
      rawText: f?.rawText ?? "",
      ok: false,
      error: f ? `${f.cause.code}: ${f.cause.message}` : (e as Error).message,
      latencyMs: Date.now() - t0,
    });
    throw new StageError(rec, f?.cause.code ?? "unknown");
  }
}

export class StageError extends Error {
  constructor(
    public readonly record: RawLlmRecord,
    public readonly code: string,
  ) {
    super(record.error ?? "stage failed");
    this.name = "StageError";
  }
}

// ---------------------------------------------------------------- propose

export interface ProposedCandidates {
  candidates: Candidate[];
  decisions: Decision[];
}

export function episodeOfBeatId(id: string): number | null {
  const m = /^E(\d+)-B\d+$/.exec(id.trim());
  return m ? Number(m[1]) : null;
}

/** Converts AI beat-ID selections into snapped candidates. Invalid references are rejected, never repaired by guessing. */
export function proposalsToCandidates(
  ep: Episode,
  proposals: { start_beat_id: string; end_beat_id: string; hook_beat_id?: string; cliffhanger_beat_id?: string; pitch?: string }[],
  idPrefix = "A",
): ProposedCandidates {
  const candidates: Candidate[] = [];
  const decisions: Decision[] = [];
  proposals.forEach((p, i) => {
    const id = `${idPrefix}-E${String(ep.number).padStart(2, "0")}-${i + 1}`;
    const sb = getBeat(ep, p.start_beat_id.trim());
    const eb = getBeat(ep, p.end_beat_id.trim());
    const reasons: string[] = [];
    if (!sb) reasons.push(`invalid beat reference: start ${p.start_beat_id}`);
    if (!eb) reasons.push(`invalid beat reference: end ${p.end_beat_id}`);
    if (sb && eb && eb.index < sb.index) reasons.push("end beat precedes start beat");
    const snapped = sb && eb && !reasons.length ? snapSegment(ep, sb, eb) : null;
    if (!snapped && !reasons.length) reasons.push("could not form a valid segment");
    if (reasons.length || !snapped) {
      decisions.push({ candidateId: id, status: "rejected", reasons });
      return;
    }
    const hook = p.hook_beat_id && getBeat(ep, p.hook_beat_id.trim()) ? p.hook_beat_id.trim() : undefined;
    const cliff = p.cliffhanger_beat_id && getBeat(ep, p.cliffhanger_beat_id.trim()) ? p.cliffhanger_beat_id.trim() : undefined;
    candidates.push({
      id,
      source: "ai",
      segments: [snapped.segment],
      durationCs: totalDuration([snapped.segment]),
      hookBeatId: hook,
      cliffhangerBeatId: cliff,
      pitch: p.pitch,
    });
  });
  return { candidates, decisions };
}

export async function runPropose(
  provider: LlmProvider,
  ep: Episode,
  opts?: CallOptions,
): Promise<StageOutcome<ProposedCandidates>> {
  const { data, record: rec } = await call(
    provider,
    "propose",
    { system: PROPOSE_SYSTEM, user: proposeUserPrompt(ep), schema: ProposeSchema, schemaName: "promo_proposals", maxTokens: 16000 },
    { episode: ep.number },
    opts,
  );
  return { value: proposalsToCandidates(ep, data.candidates), record: rec };
}

// ---------------------------------------------------------------- judge

export function judgeToEvaluation(j: JudgeOutput["evaluations"][number]): Evaluation {
  return {
    scoreSource: "ai",
    scores: { ...j.scores },
    overall: overallScore(j.scores),
    hook: j.hook,
    cliffhanger: j.cliffhanger,
    whyItWorks: j.why_it_works,
    openingInteresting: j.opening_interesting,
    endingCreatesCuriosity: j.ending_creates_curiosity,
    endingResolved: j.ending_resolved,
    makesSenseAlone: j.makes_sense_alone,
    confusingReferences: j.confusing_references,
    concerns: j.concerns,
    confidence: j.confidence,
  };
}

export async function runJudge(
  provider: LlmProvider,
  candidates: Candidate[],
  episodes: Map<number, Episode>,
  opts?: CallOptions,
): Promise<StageOutcome<Map<string, Evaluation>>> {
  const contexts = candidates.map((candidate) => ({ candidate, episodes }));
  const { data, record: rec } = await call(
    provider,
    "judge",
    { system: JUDGE_SYSTEM, user: judgeUserPrompt(contexts), schema: JudgeSchema, schemaName: "promo_evaluations", maxTokens: 16000 },
    { candidateIds: candidates.map((c) => c.id) },
    opts,
  );
  const wanted = new Set(candidates.map((c) => c.id));
  const out = new Map<string, Evaluation>();
  for (const e of data.evaluations) {
    const id = e.candidate_id.trim();
    if (wanted.has(id) && !out.has(id)) out.set(id, judgeToEvaluation(e));
  }
  return { value: out, record: rec };
}

// ---------------------------------------------------------------- stitch

export function combosToCandidates(
  combos: { segments: { start_beat_id: string; end_beat_id: string }[]; rationale: string }[],
  episodes: Map<number, Episode>,
): ProposedCandidates {
  const candidates: Candidate[] = [];
  const decisions: Decision[] = [];
  combos.forEach((c, i) => {
    const id = `S-${i + 1}`;
    const reasons: string[] = [];
    const segments: Segment[] = [];
    c.segments.forEach((s, k) => {
      const epNo = episodeOfBeatId(s.start_beat_id);
      const ep = epNo !== null ? episodes.get(epNo) : undefined;
      if (!ep || episodeOfBeatId(s.end_beat_id) !== epNo) {
        reasons.push(`segment ${k + 1}: invalid beat reference or segment spans episodes`);
        return;
      }
      const sb = getBeat(ep, s.start_beat_id.trim());
      const eb = getBeat(ep, s.end_beat_id.trim());
      const snapped = sb && eb ? snapSegment(ep, sb, eb) : null;
      if (!snapped) {
        reasons.push(`segment ${k + 1}: invalid beat reference`);
        return;
      }
      segments.push(snapped.segment);
    });
    if (reasons.length) {
      decisions.push({ candidateId: id, status: "rejected", reasons });
      return;
    }
    candidates.push({ id, source: "stitch", segments, durationCs: totalDuration(segments), pitch: c.rationale });
  });
  return { candidates, decisions };
}

export async function runStitch(
  provider: LlmProvider,
  sources: Candidate[],
  episodes: Map<number, Episode>,
  opts?: CallOptions,
): Promise<StageOutcome<ProposedCandidates>> {
  const contexts = sources.map((candidate) => ({ candidate, episodes }));
  const { data, record: rec } = await call(
    provider,
    "stitch",
    { system: STITCH_SYSTEM, user: stitchUserPrompt(contexts), schema: StitchSchema, schemaName: "promo_stitches", maxTokens: 16000 },
    { candidateIds: sources.map((c) => c.id) },
    opts,
  );
  return { value: combosToCandidates(data.combos, episodes), record: rec };
}
