import { describe, expect, it } from "vitest";
import { dedupe, overlapRatio } from "../src/core/dedupe";
import { rankPromos } from "../src/core/rank";
import { overallScore, statusFor } from "../src/core/score";
import { csvEscape, toCsv, toJson, qualityReport, computeMetrics, CSV_COLUMNS } from "../src/core/export";
import { formatTimecode } from "../src/core/timecode";
import type { Candidate, Evaluation, Promo, RunResult } from "../src/core/types";

function c(id: string, episode: number, s: number, e: number, extra?: { episode: number; s: number; e: number }): Candidate {
  const segs = [{ episode, startBeatId: "x", endBeatId: "y", startCs: s, endCs: e, startTc: formatTimecode(s), endTc: formatTimecode(e) }];
  if (extra) segs.push({ episode: extra.episode, startBeatId: "x", endBeatId: "y", startCs: extra.s, endCs: extra.e, startTc: formatTimecode(extra.s), endTc: formatTimecode(extra.e) });
  return { id, source: "ai", segments: segs, durationCs: segs.reduce((a, x) => a + x.endCs - x.startCs, 0) };
}

function ev(scores: Partial<Evaluation["scores"]> = {}, more: Partial<Evaluation> = {}): Evaluation {
  const s = { hook: 7, cliffhanger: 7, standalone: 7, intensity: 7, appeal: 7, ...scores };
  return {
    scoreSource: "ai", scores: s, overall: overallScore(s), hook: "h, with \"quotes\"", cliffhanger: "c", whyItWorks: "w",
    openingInteresting: true, endingCreatesCuriosity: true, endingResolved: false, makesSenseAlone: true,
    confusingReferences: [], concerns: [], confidence: "high", ...more,
  };
}

function promo(cand: Candidate, e: Evaluation): Promo {
  const st = statusFor(e);
  return { id: cand.id, rank: 0, status: st.status, candidate: cand, evaluation: e, warnings: st.warnings, headline: false, arc: 1 };
}

describe("dedupe", () => {
  it("measures overlap relative to the shorter clip", () => {
    expect(overlapRatio(c("a", 1, 0, 3000), c("b", 1, 1500, 4500))).toBe(0.5);
    expect(overlapRatio(c("a", 1, 0, 3000), c("b", 2, 0, 3000))).toBe(0);
    expect(overlapRatio(c("a", 1, 0, 6000), c("b", 1, 1000, 3000))).toBe(1);
  });

  it("keeps the higher scoring of two near-duplicates and records why", () => {
    const items = [
      { candidate: c("low", 1, 0, 3000), score: 5 },
      { candidate: c("high", 1, 500, 3500), score: 8 },
      { candidate: c("other", 1, 4000, 7000), score: 6 },
    ];
    const r = dedupe(items);
    expect(r.kept.map((k) => k.candidate.id)).toEqual(["high", "other"]);
    expect(r.dropped[0].item.candidate.id).toBe("low");
    expect(r.dropped[0].duplicateOf).toBe("high");
  });
});

describe("scoring and ranking", () => {
  it("applies the 25/25/20/15/15 weights", () => {
    expect(overallScore({ hook: 10, cliffhanger: 0, standalone: 0, intensity: 0, appeal: 0 })).toBe(2.5);
    expect(overallScore({ hook: 8, cliffhanger: 6, standalone: 5, intensity: 4, appeal: 10 })).toBe(6.6);
  });

  it("marks weak hooks, weak cliffhangers and resolved endings as weak", () => {
    expect(statusFor(ev({ hook: 4 })).status).toBe("weak");
    expect(statusFor(ev({ cliffhanger: 3 })).status).toBe("weak");
    expect(statusFor(ev({}, { endingResolved: true })).status).toBe("weak");
    expect(statusFor(ev()).status).toBe("recommended");
  });

  it("ranks recommended before weak even when the weak one scores higher", () => {
    const strongButResolved = promo(c("a", 1, 0, 3000), ev({ hook: 10, appeal: 10, intensity: 10 }, { endingResolved: true }));
    const solid = promo(c("b", 2, 0, 3000), ev());
    const ranked = rankPromos([strongButResolved, solid]);
    expect(ranked[0].candidate.id).toBe("b");
    expect(ranked.map((p) => p.rank)).toEqual([1, 2]);
  });

  it("caps headline picks per episode and per arc for diversity", () => {
    const ps = [
      promo(c("e1a", 1, 0, 3000), ev({ hook: 10 })),
      promo(c("e1b", 1, 4000, 7000), ev({ hook: 9 })),
      promo(c("e1c", 1, 8000, 11000), ev({ hook: 8 })),
      promo(c("e2a", 2, 0, 3000), ev({ hook: 6 })),
      promo(c("e15", 15, 0, 3000), ev({ hook: 5 })),
    ];
    const ranked = rankPromos(ps, { headlineSize: 10, maxPerEpisode: 2, maxPerArc: 3, arcSize: 10 });
    const head = ranked.filter((p) => p.headline).map((p) => p.candidate.id);
    expect(head).toEqual(["e1a", "e1b", "e2a", "e15"]);
    expect(ranked.find((p) => p.candidate.id === "e1c")!.headline).toBe(false);
    expect(ranked[ranked.length - 1].candidate.id).toBe("e1c");
  });
});

describe("exports", () => {
  const ps = rankPromos([
    promo(c("one", 1, 0, 3000), ev()),
    promo(c("two", 2, 100, 1500, { episode: 3, s: 200, e: 1800 }), ev({ hook: 3 })),
  ]);
  const run: RunResult = {
    meta: { pipelineVersion: "t", promptVersion: "t", mode: "ai", provider: "mock", model: "m", startedAt: "s", finishedAt: "f", episodesParsed: 3, episodesFailed: [], notes: [] },
    promos: ps,
    decisions: [
      { candidateId: "one", status: "accepted", reasons: ["ok"] },
      { candidateId: "two", status: "accepted", reasons: ["weak"] },
      { candidateId: "dup", status: "rejected", reasons: ["near-duplicate of one (overlap 0.9) with a lower score"] },
      { candidateId: "bad", status: "rejected", reasons: ["invalid beat reference: start E01-B999"] },
    ],
    candidatesConsidered: 4,
    rawLlm: [{ stage: "judge", key: "k", provider: "mock", model: "m", rawText: "{}", ok: true, latencyMs: 1, cached: false }],
  };

  it("escapes CSV values", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
    expect(csvEscape(null)).toBe("");
  });

  it("writes one CSV row per segment with exact timestamps", () => {
    const lines = toCsv(run).trim().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(1 + 1 + 2);
    expect(lines[1]).toContain("00:00.00,00:30.00");
    expect(lines[2]).toContain("00:01.00,00:15.00");
    expect(lines[3]).toContain("00:02.00,00:18.00");
  });

  it("writes JSON with segments, scores, mode and optional raw output", () => {
    const j = JSON.parse(toJson(run));
    expect(j.meta.mode).toBe("ai");
    expect(j.promos[0].segments[0].start).toBe("00:00.00");
    expect(j.promos[1].segments).toHaveLength(2);
    expect(j.rawLlmCalls).toBe(1);
    expect(JSON.parse(toJson(run, { includeRaw: true })).rawLlm).toHaveLength(1);
  });

  it("computes metrics and a report with the required sections", () => {
    const m = computeMetrics(run);
    expect(m.accepted).toBe(2);
    expect(m.rejected).toBe(2);
    expect(m.duplicateRate).toBe(25);
    expect(m.rejectionReasons["invalid AI beat reference"]).toBe(1);
    expect(m.hookPassRate).toBe(50);
    const md = qualityReport(run, run);
    for (const h of ["Candidate funnel", "AI versus heuristic", "Review sheet: top 15", "bottom 5", "Limitations"]) expect(md).toContain(h);
  });
});
