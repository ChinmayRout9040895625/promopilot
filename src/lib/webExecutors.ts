"use client";
/**
 * Browser-side executors for the shared pipeline. Each stage is one POST to an API route that
 * performs one LLM call. Successful responses are memoised so "Retry failed calls" only re-runs
 * what failed. Retryable failures (rate limits, timeouts, 5xx) are retried with backoff here,
 * so no single server request has to outlive the function time limit.
 */
import type { Executors } from "@/core/pipeline";
import { StageError, type ProposedCandidates, type StageOutcome } from "@/core/stages";
import type { Candidate, Episode, Evaluation, RawLlmRecord } from "@/core/types";

type Json = { ok: boolean; value?: unknown; record?: RawLlmRecord; code?: string; retryable?: boolean; error?: string };

const memo = new Map<string, unknown>();

export function clearWebCache() {
  memo.clear();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Run cancelled"));
    });
  });

function syntheticRecord(stage: RawLlmRecord["stage"], error: string, meta: Partial<RawLlmRecord>): RawLlmRecord {
  return { stage, key: "", provider: "web", model: "", rawText: "", ok: false, error, latencyMs: 0, cached: false, ...meta };
}

async function post(
  path: string,
  stage: RawLlmRecord["stage"],
  body: unknown,
  meta: Partial<RawLlmRecord>,
  accessCode: string,
  signal?: AbortSignal,
): Promise<{ value: unknown; record: RawLlmRecord }> {
  const maxAttempts = 3;
  let last: StageError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw new Error("Run cancelled");
      last = new StageError(syntheticRecord(stage, "network: could not reach the server", meta), "network");
      await sleep(2000 * 2 ** (attempt - 1), signal);
      continue;
    }
    let json: Json | null = null;
    try {
      json = (await res.json()) as Json;
    } catch {
      json = null;
    }
    if (res.ok && json?.ok) return { value: json.value, record: json.record! };
    const code = json?.code ?? (res.status === 504 ? "timeout" : `http_${res.status}`);
    const msg = json?.error ?? (res.status === 504 ? "Server function timed out" : `Server returned ${res.status}`);
    last = new StageError(json?.record ?? syntheticRecord(stage, `${code}: ${msg}`, meta), code);
    const retryable = json?.retryable ?? (res.status >= 500 || res.status === 429);
    if (!retryable || attempt === maxAttempts) break;
    await sleep(2000 * 2 ** (attempt - 1), signal);
  }
  throw last!;
}

function episodesFor(cands: Candidate[], eps: Map<number, Episode>): Episode[] {
  const nums = new Set(cands.flatMap((c) => c.segments.map((s) => s.episode)));
  return [...nums].map((n) => eps.get(n)!).filter(Boolean);
}

const keyOf = (c: Candidate) => `${c.id}:${c.segments.map((s) => `${s.episode}/${s.startCs}/${s.endCs}`).join("+")}`;

export function webExecutors(opts: { accessCode: string; stitch: boolean; signal?: AbortSignal }): Executors {
  const { accessCode, signal } = opts;
  return {
    async propose(ep): Promise<StageOutcome<ProposedCandidates>> {
      const k = `propose:${ep.number}:${ep.beats.length}:${ep.durationCs}`;
      if (memo.has(k)) return memo.get(k) as StageOutcome<ProposedCandidates>;
      const r = await post("/api/propose", "propose", { episode: ep }, { episode: ep.number }, accessCode, signal);
      const out = { value: r.value as ProposedCandidates, record: r.record };
      memo.set(k, out);
      return out;
    },
    async judge(cands, eps): Promise<StageOutcome<Map<string, Evaluation>>> {
      const k = `judge:${cands.map(keyOf).join("|")}`;
      if (memo.has(k)) return memo.get(k) as StageOutcome<Map<string, Evaluation>>;
      const r = await post("/api/judge", "judge", { candidates: cands, episodes: episodesFor(cands, eps) }, { candidateIds: cands.map((c) => c.id) }, accessCode, signal);
      const out = { value: new Map(r.value as [string, Evaluation][]), record: r.record };
      memo.set(k, out);
      return out;
    },
    stitch: opts.stitch
      ? async (sources, eps): Promise<StageOutcome<ProposedCandidates>> => {
          const k = `stitch:${sources.map(keyOf).join("|")}`;
          if (memo.has(k)) return memo.get(k) as StageOutcome<ProposedCandidates>;
          const r = await post("/api/stitch", "stitch", { sources, episodes: episodesFor(sources, eps) }, { candidateIds: sources.map((c) => c.id) }, accessCode, signal);
          const out = { value: r.value as ProposedCandidates, record: r.record };
          memo.set(k, out);
          return out;
        }
      : undefined,
  };
}
