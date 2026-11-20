import { describe, expect, it } from "vitest";
import { parseEpisode } from "../src/core/parse";
import { runPipeline, type Executors } from "../src/core/pipeline";
import { runJudge, runPropose, runStitch } from "../src/core/stages";
import { LlmError, type LlmProvider, type LlmRequest } from "../src/core/ai/provider";
import { toCsv, toJson } from "../src/core/export";
import type { Episode, RunResult } from "../src/core/types";
import { standardEpisode } from "./fixtures/synthetic";

const episodes: Episode[] = [1, 2, 3].map((n) => parseEpisode(standardEpisode(n), `episode-00${n}.txt`));

const BEAT_LINE = /^(E\d+-B\d+) \[(\d\d):(\d\d)\.(\d\d)-(\d\d):(\d\d)\.(\d\d)\] (\S+)/;

/** Scripted provider that behaves like a model: picks beat IDs from the prompt, scores candidates. */
class MockModel implements LlmProvider {
  readonly name = "mock" as const;
  readonly model = "mock-model";
  calls: Record<string, number> = {};
  constructor(private opts: { failJudge?: boolean; failProposeFor?: number; stitchScore?: number } = {}) {}

  async complete(req: LlmRequest) {
    this.calls[req.stage] = (this.calls[req.stage] ?? 0) + 1;
    if (req.stage === "propose") {
      const ep = Number(/EPISODE (\d+)/.exec(req.user)![1]);
      if (ep === this.opts.failProposeFor) throw new LlmError("server_error", "boom", false, 500);
      const beats = req.user.split("\n").map((l) => BEAT_LINE.exec(l)).filter(Boolean).map((m) => ({
        id: m![1],
        start: Number(m![2]) * 6000 + Number(m![3]) * 100 + Number(m![4]),
        end: Number(m![5]) * 6000 + Number(m![6]) * 100 + Number(m![7]),
        kind: m![8],
      }));
      const first = beats.find((b) => b.kind !== "CAMERA:")!;
      const end = [...beats].reverse().find((b) => b.end - first.start <= 4000 && b.kind !== "CAMERA:")!;
      const late = beats.find((b) => b.start >= 4000)!;
      const last = beats[beats.length - 1];
      return {
        model: this.model,
        text: JSON.stringify({
          candidates: [
            { start_beat_id: first.id, end_beat_id: end.id, hook_beat_id: first.id, cliffhanger_beat_id: end.id, pitch: "Opening slam" },
            { start_beat_id: late.id, end_beat_id: last.id, hook_beat_id: late.id, cliffhanger_beat_id: last.id, pitch: "Reveal" },
            { start_beat_id: `E${String(ep).padStart(2, "0")}-B999`, end_beat_id: last.id, hook_beat_id: "x", cliffhanger_beat_id: "y", pitch: "Hallucinated" },
          ],
        }),
      };
    }
    if (req.stage === "judge") {
      if (this.opts.failJudge) throw new LlmError("auth", "bad key", false, 401);
      const ids = [...req.user.matchAll(/=== CANDIDATE (\S+) /g)].map((m) => m[1]);
      return {
        model: this.model,
        text: JSON.stringify({
          evaluations: ids.map((id) => {
            const stitched = id.startsWith("S-");
            const strong = id.startsWith("A-") && id.endsWith("-2");
            const s = stitched ? (this.opts.stitchScore ?? 6) : strong ? 8 : 6;
            return {
              candidate_id: id,
              scores: { hook: s, cliffhanger: strong || stitched ? s : 4, standalone: s, intensity: s, appeal: s },
              hook: `hook for ${id}`, cliffhanger: `cliff for ${id}`, why_it_works: "because",
              opening_interesting: true, ending_creates_curiosity: true, ending_resolved: false, makes_sense_alone: true,
              confusing_references: [], concerns: [], confidence: "medium",
            };
          }),
        }),
      };
    }
    // stitch: join the reveal of episode 1 with the reveal of episode 2 (IDs appear in the prompt).
    const ids = [...req.user.matchAll(/^(E0[12]-B\d+) \[/gm)].map((m) => m[1]);
    const e1 = ids.filter((i) => i.startsWith("E01"));
    const e2 = ids.filter((i) => i.startsWith("E02"));
    return {
      model: this.model,
      text: JSON.stringify({
        combos: e1.length && e2.length
          ? [{ segments: [{ start_beat_id: e1[e1.length - 6], end_beat_id: e1[e1.length - 1] }, { start_beat_id: e2[e2.length - 6], end_beat_id: e2[e2.length - 1] }], rationale: "two reveals" }]
          : [],
      }),
    };
  }
}

function executors(p: LlmProvider, stitch = true): Executors {
  const opts = { sleep: async () => {} };
  return {
    propose: (ep) => runPropose(p, ep, opts),
    judge: (c, eps) => runJudge(p, c, eps, opts),
    stitch: stitch ? (c, eps) => runStitch(p, c, eps, opts) : undefined,
  };
}

function assertAllTimestampsAreBeatBoundaries(run: RunResult) {
  const byNo = new Map(episodes.map((e) => [e.number, e]));
  for (const p of run.promos) {
    for (const s of p.candidate.segments) {
      const ep = byNo.get(s.episode)!;
      expect(ep.beats.some((b) => b.startCs === s.startCs && b.startTc === s.startTc)).toBe(true);
      expect(ep.beats.some((b) => b.endCs === s.endCs && b.endTc === s.endTc)).toBe(true);
    }
    expect(p.candidate.durationCs).toBeGreaterThanOrEqual(2000);
    expect(p.candidate.durationCs).toBeLessThanOrEqual(6000);
  }
}

describe("runPipeline", () => {
  it("heuristic mode: no AI, every promo labelled heuristic and flagged for review", async () => {
    const run = await runPipeline(episodes, {}, { provider: "none", model: "none" });
    expect(run.meta.mode).toBe("heuristic");
    expect(run.meta.provider).toBe("none");
    expect(run.promos.length).toBeGreaterThan(0);
    for (const p of run.promos) {
      expect(p.evaluation.scoreSource).toBe("heuristic");
      expect(p.warnings.join(" ")).toMatch(/Heuristic estimate/);
    }
    expect(run.rawLlm).toHaveLength(0);
    assertAllTimestampsAreBeatBoundaries(run);
  });

  it("AI mode: proposes, rejects hallucinated beat IDs, judges, ranks and records raw output", async () => {
    const model = new MockModel();
    const run = await runPipeline(episodes, executors(model, false), { provider: "mock", model: "mock-model", judgeBatchSize: 3 });
    expect(run.meta.mode).toBe("ai");
    expect(run.meta.model).toBe("mock-model");
    expect(model.calls.propose).toBe(3);
    expect(model.calls.judge).toBeGreaterThan(0);
    const hallucinated = run.decisions.filter((d) => d.reasons.some((r) => /invalid beat reference/.test(r)));
    expect(hallucinated).toHaveLength(3);
    expect(run.promos.some((p) => p.evaluation.scoreSource === "ai")).toBe(true);
    // Strong AI candidates (scored 8) outrank the rest and are recommended.
    expect(run.promos[0].candidate.id).toMatch(/^A-E0\d-2$/);
    expect(run.promos[0].status).toBe("recommended");
    // Weak cliffhangers (scored 4) are flagged weak.
    expect(run.promos.filter((p) => p.status === "weak").every((p) => p.warnings.some((w) => /Weak cliffhanger/.test(w)))).toBe(true);
    expect(run.rawLlm.filter((r) => r.stage === "propose")).toHaveLength(3);
    expect(run.rawLlm.every((r) => r.ok && r.rawText.length > 0)).toBe(true);
    assertAllTimestampsAreBeatBoundaries(run);
    // Ranks are 1..n with no gaps.
    expect(run.promos.map((p) => p.rank)).toEqual(run.promos.map((_, i) => i + 1));
    // Exports carry the mode and provider.
    expect(toCsv(run)).toContain(",ai,mock,mock-model");
    expect(JSON.parse(toJson(run)).meta.provider).toBe("mock");
  });

  it("falls back to heuristic estimates when the judge fails, and says so", async () => {
    const run = await runPipeline(episodes, executors(new MockModel({ failJudge: true }), false), { provider: "mock", model: "m" });
    expect(run.promos.length).toBeGreaterThan(0);
    for (const p of run.promos) {
      expect(p.evaluation.scoreSource).toBe("heuristic");
      expect(p.warnings.join(" ")).toMatch(/AI judge failed/);
    }
    expect(run.rawLlm.some((r) => r.stage === "judge" && !r.ok && /auth/.test(r.error ?? ""))).toBe(true);
  });

  it("keeps going when one episode's proposal fails", async () => {
    const run = await runPipeline(episodes, executors(new MockModel({ failProposeFor: 2 }), false), { provider: "mock", model: "m" });
    expect(run.meta.episodesFailed).toEqual([2]);
    expect(run.meta.notes.join(" ")).toMatch(/episode\(s\) 2/);
    expect(run.promos.some((p) => p.candidate.segments[0].episode === 2)).toBe(true);
  });

  it("rejects a stitched promo that does not beat the best single clip by 0.5", async () => {
    const run = await runPipeline(episodes, executors(new MockModel({ stitchScore: 8 })), { provider: "mock", model: "m", stitch: true });
    const d = run.decisions.find((x) => x.candidateId === "S-1");
    expect(d?.status).toBe("rejected");
    expect(d?.reasons.join(" ")).toMatch(/continuous alternative stronger/);
    expect(run.promos.some((p) => p.candidate.source === "stitch")).toBe(false);
  });

  it("keeps a stitched promo that clearly beats its single-clip alternatives", async () => {
    const run = await runPipeline(episodes, executors(new MockModel({ stitchScore: 10 })), { provider: "mock", model: "m", stitch: true });
    const stitched = run.promos.find((p) => p.candidate.source === "stitch");
    expect(stitched).toBeDefined();
    expect(stitched!.candidate.segments).toHaveLength(2);
    expect(stitched!.candidate.segments[0].episode).toBe(1);
    expect(stitched!.candidate.segments[1].episode).toBe(2);
    expect(stitched!.warnings.join(" ")).toMatch(/Multi-segment/);
    assertAllTimestampsAreBeatBoundaries(run);
  });
});
