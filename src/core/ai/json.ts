import type { z } from "zod";
import { LlmError, isLlmError, type LlmProvider, type LlmRequest } from "./provider";

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface CallOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  cache?: CacheStore;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CallResult<T> {
  data: T;
  rawText: string;
  attempts: number;
  cached: boolean;
  cacheKey: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Model ID reported by the provider for this response (absent for cache hits). */
  servedModel?: string;
}

export class LlmCallFailure extends Error {
  constructor(
    public readonly cause: LlmError,
    public readonly rawText: string,
    public readonly attempts: number,
    public readonly cacheKey: string,
  ) {
    super(cause.message);
    this.name = "LlmCallFailure";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** FNV-1a 64-bit hash (hex). Deterministic, dependency-free, works in browser and Node. */
export function stableHash(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function cacheKeyFor(provider: LlmProvider, req: LlmRequest): string {
  return `${req.stage}-${stableHash([provider.name, provider.model, req.schemaName, req.system, req.user].join("\u0000"))}`;
}

/** Extracts the first JSON object from model text, tolerating code fences or stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("no JSON object found");
  }
}

export function parseAndValidate<S extends z.ZodType>(schema: S, text: string): z.infer<S> {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (e) {
    throw new LlmError("invalid_output", `Model output was not valid JSON (${(e as Error).message})`, true);
  }
  const res = schema.safeParse(parsed);
  if (!res.success) {
    const issues = res.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new LlmError("invalid_output", `Model output failed schema validation: ${issues}`, true);
  }
  return res.data;
}

function backoff(attempt: number, base: number, max: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, max);
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/**
 * Calls the provider, validates JSON against the schema, retries retryable failures with
 * exponential backoff + jitter (honouring retry-after), and caches successful raw responses.
 */
export async function callJson<S extends z.ZodType>(
  provider: LlmProvider,
  req: LlmRequest & { schema: S },
  opts: CallOptions = {},
): Promise<CallResult<z.infer<S>>> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseDelayMs ?? 1500;
  const max = opts.maxDelayMs ?? 30000;
  const sleep = opts.sleep ?? defaultSleep;
  const key = cacheKeyFor(provider, req);
  const t0 = Date.now();

  if (opts.cache) {
    const hit = await opts.cache.get(key);
    if (hit !== undefined) {
      try {
        return { data: parseAndValidate(req.schema, hit), rawText: hit, attempts: 0, cached: true, cacheKey: key, latencyMs: 0 };
      } catch {
        // Stale or corrupt cache entry: fall through to a live call.
      }
    }
  }

  let lastErr: LlmError = new LlmError("unknown", "No attempt made", false);
  let lastText = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new LlmCallFailure(new LlmError("timeout", "Aborted", false), lastText, attempt - 1, key);
    try {
      const res = await provider.complete(req, opts.signal);
      lastText = res.text;
      const data = parseAndValidate(req.schema, res.text);
      if (opts.cache) await opts.cache.set(key, res.text);
      return { data, rawText: res.text, attempts: attempt, cached: false, cacheKey: key, latencyMs: Date.now() - t0, usage: res.usage, servedModel: res.model };
    } catch (e) {
      lastErr = isLlmError(e) ? e : new LlmError("unknown", e instanceof Error ? e.message : String(e), false);
      // Invalid output gets at most one retry; transient API errors get the full budget.
      const allowed = lastErr.code === "invalid_output" ? Math.min(2, maxAttempts) : maxAttempts;
      if (!lastErr.retryable || attempt >= allowed) break;
      await sleep(backoff(attempt, base, max, lastErr.retryAfterMs));
    }
  }
  throw new LlmCallFailure(lastErr, lastText, maxAttempts, key);
}
