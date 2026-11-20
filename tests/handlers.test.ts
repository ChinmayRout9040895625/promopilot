import { describe, expect, it } from "vitest";
import { parseEpisode } from "../src/core/parse";
import { runJudge, runPropose } from "../src/core/stages";
import { checkAccess, handleJudge, handlePropose, statusPayload } from "../src/server/handlers";
import type { LlmProvider, LlmRequest } from "../src/core/ai/provider";
import { standardEpisode } from "./fixtures/synthetic";

const ep = parseEpisode(standardEpisode(1), "episode-001.txt");

const fixed: LlmProvider = {
  name: "mock",
  model: "m",
  async complete(req: LlmRequest) {
    if (req.stage === "propose") {
      return { model: "m", text: JSON.stringify({ candidates: [{ start_beat_id: "E01-B002", end_beat_id: "E01-B013", hook_beat_id: "E01-B002", cliffhanger_beat_id: "E01-B013", pitch: "p" }] }) };
    }
    const ids = [...req.user.matchAll(/=== CANDIDATE (\S+) /g)].map((m) => m[1]);
    return {
      model: "m",
      text: JSON.stringify({
        evaluations: ids.map((id) => ({
          candidate_id: id, scores: { hook: 7, cliffhanger: 6, standalone: 7, intensity: 6, appeal: 7 }, hook: "h", cliffhanger: "c",
          why_it_works: "w", opening_interesting: true, ending_creates_curiosity: true, ending_resolved: false, makes_sense_alone: true,
          confusing_references: [], concerns: [], confidence: "high",
        })),
      }),
    };
  },
};

describe("API handlers", () => {
  it("web path and CLI path produce identical proposals for the same model output", async () => {
    const direct = await runPropose(fixed, ep);
    const viaRoute = await handlePropose(JSON.parse(JSON.stringify({ episode: ep })), null, {}, fixed);
    expect(viaRoute.status).toBe(200);
    expect((viaRoute.body as { value: unknown }).value).toEqual(direct.value);
  });

  it("web path and CLI path produce identical judgments", async () => {
    const { value } = await runPropose(fixed, ep);
    const direct = await runJudge(fixed, value.candidates, new Map([[1, ep]]));
    const viaRoute = await handleJudge(JSON.parse(JSON.stringify({ candidates: value.candidates, episodes: [ep] })), null, {}, fixed);
    expect(viaRoute.status).toBe(200);
    expect(new Map((viaRoute.body as { value: [string, unknown][] }).value)).toEqual(direct.value);
  });

  it("rejects malformed bodies without calling the model", async () => {
    const r = await handlePropose({ episode: { number: "x" } }, null, {}, fixed);
    expect(r.status).toBe(400);
  });

  it("returns 503 with a reason when AI is not configured", async () => {
    const r = await handlePropose({ episode: ep }, null, { AI_PROVIDER: "none" });
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe("ai_unavailable");
  });

  it("enforces the optional access code", async () => {
    const env = { APP_ACCESS_CODE: "open-sesame", AI_PROVIDER: "none" };
    expect(checkAccess(null, env)).toBe(false);
    expect(checkAccess("wrong", env)).toBe(false);
    expect(checkAccess("open-sesame", env)).toBe(true);
    expect(checkAccess(null, {})).toBe(true);
    const r = await handlePropose({ episode: ep }, "wrong", env);
    expect(r.status).toBe(401);
  });

  it("status reports mode and model but never secrets", () => {
    const s = statusPayload({ AI_PROVIDER: "anthropic", AI_MODEL: "claude-x", ANTHROPIC_API_KEY: "sk-secret-value", APP_ACCESS_CODE: "c0de" });
    expect(s.aiEnabled).toBe(true);
    expect(s.model).toBe("claude-x");
    expect(s.accessCodeRequired).toBe(true);
    const txt = JSON.stringify(s);
    expect(txt).not.toContain("sk-secret-value");
    expect(txt).not.toContain("c0de");
  });
});
