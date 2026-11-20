/**
 * Server-only request handlers behind the API routes. Kept free of Next.js imports so they can
 * be unit-tested and so the routes stay thin. Each handler performs at most one LLM call, which
 * keeps every request well inside serverless function time limits.
 */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { providerFromEnv, type ProviderConfig } from "../core/ai/factory";
import { runJudge, runPropose, runStitch, StageError } from "../core/stages";
import { PIPELINE_VERSION } from "../core/pipeline";
import { PROMPT_VERSION } from "../core/ai/prompts";
import type { Candidate, Episode } from "../core/types";
import type { LlmProvider } from "../core/ai/provider";

export interface HandlerResult {
  status: number;
  body: unknown;
}

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------- input schemas (bounded)

const BeatIn = z.object({
  id: z.string().max(20),
  episode: z.number().int(),
  index: z.number().int().min(0),
  kind: z.enum(["camera", "action", "dialogue", "sfx", "other"]),
  label: z.string().max(300),
  speaker: z.string().max(200).optional(),
  delivery: z.string().max(300).optional(),
  offscreen: z.boolean().optional(),
  text: z.string().max(4000),
  startCs: z.number().int().min(0),
  endCs: z.number().int().min(0),
  startTc: z.string().max(12),
  endTc: z.string().max(12),
  scene: z.number().int(),
});

const EpisodeIn = z.object({
  number: z.number().int().min(0).max(10000),
  fileName: z.string().max(300),
  logline: z.string().max(4000),
  continuity: z.string().max(4000),
  scenes: z.array(z.object({ number: z.number().int(), heading: z.string().max(300), startCs: z.number().int().nullable(), endCs: z.number().int().nullable() })).max(200),
  beats: z.array(BeatIn).min(1).max(3000),
  durationCs: z.number().int().min(0),
  warnings: z.array(z.string().max(300)).max(50),
});

const SegmentIn = z.object({
  episode: z.number().int(),
  startBeatId: z.string().max(20),
  endBeatId: z.string().max(20),
  startCs: z.number().int().min(0),
  endCs: z.number().int().min(0),
  startTc: z.string().max(12),
  endTc: z.string().max(12),
});

const CandidateIn = z.object({
  id: z.string().max(40),
  source: z.enum(["heuristic", "ai", "stitch"]),
  segments: z.array(SegmentIn).min(1).max(3),
  durationCs: z.number().int(),
  hookBeatId: z.string().max(20).optional(),
  cliffhangerBeatId: z.string().max(20).optional(),
  pitch: z.string().max(1000).optional(),
});

export const ProposeBody = z.object({ episode: EpisodeIn });
export const JudgeBody = z.object({ candidates: z.array(CandidateIn).min(1).max(8), episodes: z.array(EpisodeIn).min(1).max(8) });
export const StitchBody = z.object({ sources: z.array(CandidateIn).min(2).max(25), episodes: z.array(EpisodeIn).min(1).max(25) });

// ---------------------------------------------------------------- config + access

let cached: { key: string; cfg: ProviderConfig } | null = null;

export function getConfig(env: Env = process.env): ProviderConfig {
  const key = [env.AI_PROVIDER, env.AI_MODEL, env.AI_EFFORT, env.ANTHROPIC_API_KEY?.length, env.GEMINI_API_KEY?.length, env.GEMINI_BASE_URL, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY?.length, env.OPENAI_API_KEY?.length, env.OPENAI_COMPAT_RESPONSE_FORMAT].join("|");
  if (!cached || cached.key !== key) cached = { key, cfg: providerFromEnv(env) };
  return cached.cfg;
}

export function accessCodeRequired(env: Env = process.env): boolean {
  return Boolean(env.APP_ACCESS_CODE?.trim());
}

export function checkAccess(supplied: string | null, env: Env = process.env): boolean {
  const expected = env.APP_ACCESS_CODE?.trim();
  if (!expected) return true;
  if (!supplied) return false;
  const a = Buffer.from(supplied.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function statusPayload(env: Env = process.env) {
  const cfg = getConfig(env);
  return {
    aiEnabled: cfg.provider !== null,
    provider: cfg.mode,
    model: cfg.provider ? cfg.model : null,
    reason: cfg.provider ? null : cfg.reason,
    accessCodeRequired: accessCodeRequired(env),
    pipelineVersion: PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION,
  };
}

// ---------------------------------------------------------------- stage handlers

/** Server-side retry budget is small: the browser retries whole requests, so one request never outlives the function limit. */
const routeCallOptions = () => ({ maxAttempts: 2, maxDelayMs: 4000, signal: AbortSignal.timeout(58000) });

function guard(accessCode: string | null, env: Env): { provider: LlmProvider } | HandlerResult {
  if (!checkAccess(accessCode, env)) return { status: 401, body: { ok: false, code: "access_denied", error: "Access code required or incorrect" } };
  const cfg = getConfig(env);
  if (!cfg.provider) return { status: 503, body: { ok: false, code: "ai_unavailable", error: `AI is not configured: ${cfg.reason}` } };
  return { provider: cfg.provider };
}

function stageFailure(e: unknown): HandlerResult {
  if (e instanceof StageError) {
    const retryable = ["rate_limited", "overloaded", "server_error", "network", "timeout", "invalid_output", "truncated"].includes(e.code);
    return { status: retryable ? 503 : 502, body: { ok: false, code: e.code, retryable, error: e.message, record: e.record } };
  }
  // Unknown failures: do not echo internals.
  return { status: 500, body: { ok: false, code: "internal", retryable: true, error: "Unexpected server error" } };
}

function badRequest(err: z.ZodError): HandlerResult {
  return { status: 400, body: { ok: false, code: "bad_request", error: `Invalid request: ${err.issues.slice(0, 3).map((i) => i.path.join(".")).join(", ")}` } };
}

export async function handlePropose(json: unknown, accessCode: string | null, env: Env = process.env, provider?: LlmProvider): Promise<HandlerResult> {
  const g = provider ? { provider } : guard(accessCode, env);
  if ("status" in g) return g;
  const parsed = ProposeBody.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const r = await runPropose(g.provider, parsed.data.episode as Episode, routeCallOptions());
    return { status: 200, body: { ok: true, value: r.value, record: r.record } };
  } catch (e) {
    return stageFailure(e);
  }
}

export async function handleJudge(json: unknown, accessCode: string | null, env: Env = process.env, provider?: LlmProvider): Promise<HandlerResult> {
  const g = provider ? { provider } : guard(accessCode, env);
  if ("status" in g) return g;
  const parsed = JudgeBody.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error);
  const episodes = new Map(parsed.data.episodes.map((e) => [e.number, e as Episode]));
  try {
    const r = await runJudge(g.provider, parsed.data.candidates as Candidate[], episodes, routeCallOptions());
    return { status: 200, body: { ok: true, value: [...r.value.entries()], record: r.record } };
  } catch (e) {
    return stageFailure(e);
  }
}

export async function handleStitch(json: unknown, accessCode: string | null, env: Env = process.env, provider?: LlmProvider): Promise<HandlerResult> {
  const g = provider ? { provider } : guard(accessCode, env);
  if ("status" in g) return g;
  const parsed = StitchBody.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error);
  const episodes = new Map(parsed.data.episodes.map((e) => [e.number, e as Episode]));
  try {
    const r = await runStitch(g.provider, parsed.data.sources as Candidate[], episodes, routeCallOptions());
    return { status: 200, body: { ok: true, value: r.value, record: r.record } };
  } catch (e) {
    return stageFailure(e);
  }
}
