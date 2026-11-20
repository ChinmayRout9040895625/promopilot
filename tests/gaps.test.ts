/** Tests for the stricter quality gate, rank reasons, adjacency rule and the generic OpenAI-compatible provider. */
import { describe, expect, it, vi } from "vitest";
import { overallScore, statusFor, weakReasons } from "../src/core/score";
import { rankPromos, gapBetween } from "../src/core/rank";
import { providerFromEnv } from "../src/core/ai/factory";
import { OpenAICompatibleProvider } from "../src/core/ai/openaiCompatible";
import { GeminiProvider } from "../src/core/ai/gemini";
import { ProposeSchema } from "../src/core/ai/schemas";
import { toCsv } from "../src/core/export";
import { formatTimecode } from "../src/core/timecode";
import type { Candidate, Evaluation, Promo, RunResult } from "../src/core/types";

function ev(scores: Partial<Evaluation["scores"]> = {}, more: Partial<Evaluation> = {}): Evaluation {
  const s = { hook: 7, cliffhanger: 7, standalone: 7, intensity: 7, appeal: 7, ...scores };
  return {
    scoreSource: "ai", scores: s, overall: overallScore(s), hook: "h", cliffhanger: "c", whyItWorks: "w",
    openingInteresting: true, endingCreatesCuriosity: true, endingResolved: false, makesSenseAlone: true,
    confusingReferences: [], concerns: [], confidence: "high", ...more,
  };
}
function cand(id: string, episode: number, s: number, e: number): Candidate {
  return { id, source: "ai", durationCs: e - s, segments: [{ episode, startBeatId: "x", endBeatId: "y", startCs: s, endCs: e, startTc: formatTimecode(s), endTc: formatTimecode(e) }] };
}
function promo(c: Candidate, e: Evaluation): Promo {
  const st = statusFor(e);
  return { id: c.id, rank: 0, status: st.status, candidate: c, evaluation: e, warnings: st.warnings, headline: false, arc: 1 };
}

describe("quality gate uses the judge's yes/no verdicts", () => {
  it.each([
    ["makesSenseAlone", { makesSenseAlone: false }, /new viewer/],
    ["openingInteresting", { openingInteresting: false }, /opening 3 seconds/],
    ["endingCreatesCuriosity", { endingCreatesCuriosity: false }, /not to create curiosity/],
    ["endingResolved", { endingResolved: true }, /resolved/],
  ])("%s=false makes a promo weak even with good scores", (_n, more, re) => {
    const e = ev({ hook: 9, cliffhanger: 9 }, more as Partial<Evaluation>);
    expect(statusFor(e).status).toBe("weak");
    expect(weakReasons(e).join(" ")).toMatch(re);
  });

  it("heuristic results (no verdicts) are gated on scores only", () => {
    const e = ev({}, { scoreSource: "heuristic", openingInteresting: null, endingCreatesCuriosity: null, endingResolved: null, makesSenseAlone: null });
    expect(statusFor(e).status).toBe("recommended");
  });
});

describe("rank reasons and the adjacency rule", () => {
  it("holds back a clip that runs on from a post-first pick in the same episode, and says why", () => {
    const ranked = rankPromos([
      promo(cand("a", 3, 0, 3000), ev({ hook: 9 })),
      promo(cand("b", 3, 2900, 5900), ev({ hook: 8 })), // overlaps a by 1 s
      promo(cand("c", 3, 6500, 9500), ev({ hook: 7 })), // 6 s after b, but 35 s after a
      promo(cand("d", 4, 0, 3000), ev({ hook: 6 })),
    ]);
    const by = (id: string) => ranked.find((p) => p.candidate.id === id)!;
    expect(by("a").headline).toBe(true);
    expect(by("b").headline).toBe(false);
    expect(by("b").rankReason).toMatch(/runs on from post-first pick #1 /);
    expect(by("c").headline).toBe(true);
    expect(by("d").headline).toBe(true);
    expect(by("a").rankReason).toMatch(/^Post first: the highest-scoring recommended promo/);
    expect(by("c").rankReason).toMatch(/1 higher-scoring promo was held back/);
  });

  it("explains episode caps and weak ranks", () => {
    const ranked = rankPromos([
      promo(cand("a", 1, 0, 3000), ev({ hook: 10 })),
      promo(cand("b", 1, 5000, 8000), ev({ hook: 9 })),
      promo(cand("c", 1, 10000, 13000), ev({ hook: 8 })),
      promo(cand("w", 2, 0, 3000), ev({ hook: 3 })),
    ]);
    const by = (id: string) => ranked.find((p) => p.candidate.id === id)!;
    expect(by("c").rankReason).toMatch(/episode 1 already has 2 post-first picks/);
    expect(by("w").rankReason).toMatch(/^Ranked with the weak promos: weak hook \(3\/10\)/);
    expect(ranked.every((p) => p.rankReason && p.rankReason.length > 10)).toBe(true);
  });

  it("measures gaps between clips in the same episode only", () => {
    const a = promo(cand("a", 1, 0, 3000), ev());
    expect(gapBetween(a, promo(cand("b", 1, 3500, 5000), ev()))).toBe(500);
    expect(gapBetween(a, promo(cand("c", 2, 3500, 5000), ev()))).toBeNull();
  });

  it("exports the rank reason in the CSV", () => {
    const promos = rankPromos([promo(cand("a", 1, 0, 3000), ev())]);
    const run = { meta: { mode: "ai", provider: "p", model: "m" }, promos } as unknown as RunResult;
    const [head, row] = toCsv(run).trim().split("\r\n");
    expect(head.split(",")[4]).toBe("rank_reason");
    expect(row).toContain("Post first: the highest-scoring recommended promo");
  });
});

describe("generic OpenAI-compatible provider", () => {
  it("is configured from OPENAI_COMPAT_* variables", () => {
    expect(providerFromEnv({ AI_PROVIDER: "openai-compatible", AI_MODEL: "m" }).reason).toMatch(/OPENAI_COMPAT_BASE_URL/);
    expect(providerFromEnv({ AI_PROVIDER: "openai-compatible", AI_MODEL: "m", OPENAI_COMPAT_BASE_URL: "https://llm.example.com/v1" }).reason).toMatch(/OPENAI_COMPAT_API_KEY/);
    const c = providerFromEnv({ AI_PROVIDER: "openai-compatible", AI_MODEL: "their-model", OPENAI_COMPAT_BASE_URL: "https://llm.example.com/v1", OPENAI_COMPAT_API_KEY: "k" });
    expect(c.mode).toBe("openai-compatible");
    expect(c.provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(c.provider!.name).toBe("openai-compatible");
    expect(c.provider!.model).toBe("their-model");
    // The "openai" shorthand defaults the base URL.
    expect(providerFromEnv({ AI_PROVIDER: "openai", AI_MODEL: "m", OPENAI_API_KEY: "k" }).mode).toBe("openai-compatible");
  });

  async function capture(responseFormat: "json_schema" | "json_object" | "none") {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 }));
    const p = new OpenAICompatibleProvider({ apiKey: "k", model: "m", baseUrl: "https://llm.example.com/v1/", responseFormat, fetchImpl: fetchImpl as typeof fetch });
    await p.complete({ stage: "propose", system: "SYS", user: "U", schema: ProposeSchema, schemaName: "promo_proposals" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    return { url, body: JSON.parse(String(init.body)) };
  }

  it("posts to {baseUrl}/chat/completions with native JSON schema by default", async () => {
    const { url, body } = await capture("json_schema");
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].content).toBe("SYS");
  });

  it("falls back to putting the schema in the prompt for servers without schema support", async () => {
    const obj = await capture("json_object");
    expect(obj.body.response_format).toEqual({ type: "json_object" });
    expect(obj.body.messages[0].content).toContain("matches this JSON Schema");
    const none = await capture("none");
    expect(none.body.response_format).toBeUndefined();
    expect(none.body.messages[0].content).toContain("start_beat_id");
  });

  it("keeps Gemini as a preset with its own name and error label", async () => {
    const g = new GeminiProvider({ apiKey: "k", model: "gm", fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch });
    expect(g.name).toBe("gemini");
    const e = await g.complete({ stage: "s", system: "s", user: "u", schema: ProposeSchema, schemaName: "x" }).catch((x) => x);
    expect(e.message).toMatch(/^Gemini API key/);
  });
});
