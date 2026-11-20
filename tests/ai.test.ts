import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { callJson, extractJson, parseAndValidate, LlmCallFailure, type CacheStore } from "../src/core/ai/json";
import { LlmError, type LlmProvider, type LlmRequest } from "../src/core/ai/provider";
import { JudgeSchema, ProposeSchema } from "../src/core/ai/schemas";
import { providerFromEnv } from "../src/core/ai/factory";
import { GeminiProvider, toCompatSchema } from "../src/core/ai/gemini";
import { AnthropicProvider, mapAnthropicError } from "../src/core/ai/anthropic";

const req: LlmRequest = { stage: "propose", system: "s", user: "u", schema: ProposeSchema, schemaName: "p" };
const good = JSON.stringify({ candidates: [{ start_beat_id: "E01-B001", end_beat_id: "E01-B010", hook_beat_id: "E01-B001", cliffhanger_beat_id: "E01-B010", pitch: "x" }] });

function provider(responses: (string | LlmError)[]): LlmProvider & { calls: number } {
  const p = {
    name: "mock" as const,
    model: "mock-1",
    calls: 0,
    async complete() {
      const r = responses[Math.min(p.calls, responses.length - 1)];
      p.calls++;
      if (r instanceof LlmError) throw r;
      return { text: r, model: "mock-1" };
    },
  };
  return p;
}
const noSleep = { sleep: async () => {} };

describe("AI response validation", () => {
  it("extracts JSON from fenced or chatty output", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
  });

  it("validates against the zod schema", () => {
    expect(parseAndValidate(ProposeSchema, good).candidates).toHaveLength(1);
    expect(() => parseAndValidate(ProposeSchema, '{"candidates":[{"start_beat_id":"x"}]}')).toThrow(/schema validation/);
    expect(() => parseAndValidate(ProposeSchema, "not json")).toThrow(/not valid JSON/);
    const badScore = {
      evaluations: [{
        candidate_id: "a", scores: { hook: 11, cliffhanger: 5, standalone: 5, intensity: 5, appeal: 5 },
        hook: "h", cliffhanger: "c", why_it_works: "w", opening_interesting: true, ending_creates_curiosity: true,
        ending_resolved: false, makes_sense_alone: true, confusing_references: [], concerns: [], confidence: "high",
      }],
    };
    expect(() => parseAndValidate(JudgeSchema, JSON.stringify(badScore))).toThrow(/schema validation/);
  });
});

describe("callJson retries, backoff and cache", () => {
  it("retries rate limits and then succeeds", async () => {
    const p = provider([new LlmError("rate_limited", "429", true, 429), new LlmError("server_error", "500", true, 500), good]);
    const sleep = vi.fn(async () => {});
    const r = await callJson(p, req, { sleep });
    expect(r.attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("honours retry-after", async () => {
    const p = provider([new LlmError("rate_limited", "429", true, 429, 7000), good]);
    const sleep = vi.fn(async () => {});
    await callJson(p, req, { sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("does not retry non-retryable errors", async () => {
    const p = provider([new LlmError("auth", "bad key", false, 401), good]);
    await expect(callJson(p, req, noSleep)).rejects.toBeInstanceOf(LlmCallFailure);
    expect(p.calls).toBe(1);
  });

  it("retries invalid output once, then fails with the raw text kept", async () => {
    const p = provider(["nope", "still nope", good]);
    const err = await callJson(p, req, noSleep).catch((e) => e);
    expect(err).toBeInstanceOf(LlmCallFailure);
    expect(err.cause.code).toBe("invalid_output");
    expect(err.rawText).toBe("still nope");
    expect(p.calls).toBe(2);
  });

  it("serves repeated calls from the cache (resumable runs)", async () => {
    const store = new Map<string, string>();
    const cache: CacheStore = { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
    const p = provider([good]);
    const first = await callJson(p, req, { cache });
    const second = await callJson(p, req, { cache });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(p.calls).toBe(1);
    // A different model must not hit the same cache entry.
    const q = { ...provider([good]), model: "other" };
    expect((await callJson(q, req, { cache })).cached).toBe(false);
  });
});

describe("provider switching from environment", () => {
  it("selects heuristic mode with a reason when unconfigured", () => {
    expect(providerFromEnv({}).mode).toBe("none");
    expect(providerFromEnv({ AI_PROVIDER: "none" }).provider).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: "cohere", AI_MODEL: "x" }).reason).toMatch(/Unknown AI_PROVIDER/);
    expect(providerFromEnv({ AI_PROVIDER: "anthropic" }).reason).toMatch(/AI_MODEL/);
    expect(providerFromEnv({ AI_PROVIDER: "anthropic", AI_MODEL: "m" }).reason).toMatch(/ANTHROPIC_API_KEY/);
    expect(providerFromEnv({ AI_PROVIDER: "gemini", AI_MODEL: "m" }).reason).toMatch(/GEMINI_API_KEY/);
  });

  it("builds the configured provider with the configured model", () => {
    const a = providerFromEnv({ AI_PROVIDER: "anthropic", AI_MODEL: "claude-test", ANTHROPIC_API_KEY: "k" });
    expect(a.mode).toBe("anthropic");
    expect(a.provider).toBeInstanceOf(AnthropicProvider);
    expect(a.provider!.model).toBe("claude-test");
    const g = providerFromEnv({ AI_PROVIDER: "Gemini", AI_MODEL: "gem-test", GEMINI_API_KEY: "k" });
    expect(g.mode).toBe("gemini");
    expect(g.provider).toBeInstanceOf(GeminiProvider);
    expect(g.provider!.model).toBe("gem-test");
  });

  it("never puts the API key in a reason string", () => {
    const r = providerFromEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "secret-123" });
    expect(JSON.stringify(r.reason)).not.toContain("secret-123");
  });
});

describe("Gemini adapter (OpenAI-compatible endpoint)", () => {
  it("sends a JSON-schema request with bearer auth and returns the message text", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response(JSON.stringify({ model: "gem", choices: [{ message: { content: good }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    });
    const g = new GeminiProvider({ apiKey: "k1", model: "gem", fetchImpl: fetchImpl as typeof fetch });
    const r = await g.complete(req);
    expect(r.text).toBe(good);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k1");
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("gem");
    expect(body.response_format.type).toBe("json_schema");
    expect(JSON.stringify(body.response_format)).not.toContain("additionalProperties");
  });

  it("maps 429 to a retryable error with retry-after and 401 to non-retryable", async () => {
    const mk = (status: number) =>
      new GeminiProvider({ apiKey: "k1", model: "gem", fetchImpl: (async () => new Response("{}", { status, headers: { "retry-after": "3" } })) as typeof fetch });
    const e429 = await mk(429).complete(req).catch((e) => e);
    expect(e429.code).toBe("rate_limited");
    expect(e429.retryable).toBe(true);
    expect(e429.retryAfterMs).toBe(3000);
    const e401 = await mk(401).complete(req).catch((e) => e);
    expect(e401.retryable).toBe(false);
    expect(e401.message).not.toContain("k1");
  });

  it("treats truncated output as a retryable error", async () => {
    const g = new GeminiProvider({ apiKey: "k", model: "gem", fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }), { status: 200 })) as typeof fetch });
    const e = await g.complete(req).catch((x) => x);
    expect(e.code).toBe("truncated");
  });

  it("strips schema keywords the compat endpoint rejects", () => {
    const s = toCompatSchema(ProposeSchema);
    expect(JSON.stringify(s)).not.toMatch(/\$schema|additionalProperties/);
  });
});

describe("Anthropic error mapping", () => {
  it("maps SDK error classes to retryable / non-retryable errors", () => {
    const h = new Headers({ "retry-after": "2" });
    const rate = mapAnthropicError(Anthropic.APIError.generate(429, { error: { message: "x" } }, "rate", h));
    expect(rate.code).toBe("rate_limited");
    expect(rate.retryable).toBe(true);
    expect(rate.retryAfterMs).toBe(2000);
    expect(mapAnthropicError(Anthropic.APIError.generate(401, {}, "auth", new Headers())).retryable).toBe(false);
    expect(mapAnthropicError(Anthropic.APIError.generate(500, {}, "err", new Headers())).retryable).toBe(true);
    expect(mapAnthropicError(Anthropic.APIError.generate(529, {}, "over", new Headers())).code).toBe("overloaded");
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: "down" })).code).toBe("network");
    expect(mapAnthropicError(Anthropic.APIError.generate(404, {}, "nf", new Headers())).code).toBe("config");
  });
});
