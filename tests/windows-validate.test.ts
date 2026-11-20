import { describe, expect, it } from "vitest";
import { parseEpisode } from "../src/core/parse";
import { snapSegment, firstSeconds, totalDuration } from "../src/core/windows";
import { validateCandidate } from "../src/core/validate";
import { formatTimecode } from "../src/core/timecode";
import { proposalsToCandidates } from "../src/core/stages";
import { heuristicCandidates, enumerateWindows } from "../src/core/heuristic";
import type { Candidate, Episode, Segment } from "../src/core/types";
import { renderEpisode, standardEpisode, type FixtureBeat } from "./fixtures/synthetic";

const ep = parseEpisode(standardEpisode(1), "episode-001.txt");
const eps = new Map([[1, ep]]);
const byStart = (e: Episode, cs: number, kind?: string) => e.beats.find((b) => b.startCs === cs && (!kind || b.kind === kind))!;

function seg(e: Episode, startCs: number, endCs: number): Segment {
  const sb = e.beats.find((b) => b.startCs === startCs)!;
  const eb = [...e.beats].reverse().find((b) => b.endCs === endCs)!;
  return { episode: e.number, startBeatId: sb.id, endBeatId: eb.id, startCs, endCs, startTc: formatTimecode(startCs), endTc: formatTimecode(endCs) };
}
function cand(segments: Segment[], id = "T-1"): Candidate {
  return { id, source: "ai", segments, durationCs: totalDuration(segments) };
}

describe("snapSegment", () => {
  it("widens to whole content beats, then aligns to camera shot boundaries", () => {
    // Start on Mara's line at 1.00 s: the action beat 0.50-3.00 straddles it, then the shot at 0.00 is within 1 s.
    const start = byStart(ep, 100, "dialogue");
    const end = byStart(ep, 3050, "dialogue"); // Tobin line ends 39.00; shot ends 40.00
    const r = snapSegment(ep, start, end)!;
    expect(r.segment.startCs).toBe(0);
    expect(r.segment.endCs).toBe(4000);
    expect(r.segment.startTc).toBe("00:00.00");
    expect(r.segment.endTc).toBe("00:40.00");
    expect(r.adjustments.join(" ")).toMatch(/start moved back/);
    expect(r.adjustments.join(" ")).toMatch(/camera shot/);
  });

  it("never ends in the middle of a line", () => {
    const beats: FixtureBeat[] = [
      { label: "CAMERA", start: 0, end: 1000, text: "a" },
      { label: "AMY (Calm)", start: 800, end: 1500, text: '"Long line."' },
      { label: "CAMERA", start: 1000, end: 2500, text: "b" },
    ];
    const e = parseEpisode(renderEpisode({ number: 2, scenes: [{ heading: "X", start: 0, end: 2500, beats }] }), "episode-002.txt");
    const r = snapSegment(e, e.beats[0], e.beats[0])!;
    expect(r.segment.endCs).toBe(1500);
    expect(r.adjustments.join(" ")).toMatch(/end extended/);
  });

  it("handles camera gaps: cuts stay on beat boundaries when no shot covers the region", () => {
    const start = byStart(ep, 2000, "action"); // inside the 20.00-24.00 camera gap
    const end = byStart(ep, 6100, "dialogue");
    const r = snapSegment(ep, start, end)!;
    expect(r.segment.startCs).toBe(2000);
    expect(validateCandidate(cand([r.segment]), eps).ok).toBe(true);
  });

  it("returns null when end precedes start or beats belong to another episode", () => {
    expect(snapSegment(ep, ep.beats[10], ep.beats[2])).toBeNull();
    const other = parseEpisode(standardEpisode(2), "episode-002.txt");
    expect(snapSegment(ep, other.beats[0], other.beats[5])).toBeNull();
  });

  it("reports what the viewer gets in the first 3 seconds", () => {
    const s = seg(ep, 0, 4000);
    expect(firstSeconds(ep, s).map((b) => b.kind)).toEqual(["camera", "action", "dialogue"]);
  });
});

describe("validateCandidate", () => {
  // Content beats at exact boundaries so we can hit 19.99 / 20.00 / 60.00 / 60.01 seconds.
  const beats: FixtureBeat[] = [
    { label: "ACTION", start: 0, end: 500, text: "a" },
    { label: "ACTION", start: 500, end: 1999, text: "b" },
    { label: "ACTION", start: 1999, end: 2000, text: "c" },
    { label: "ACTION", start: 2000, end: 6000, text: "d" },
    { label: "ACTION", start: 6000, end: 6001, text: "e" },
    { label: "ACTION", start: 6001, end: 7000, text: "f" },
  ];
  const e = parseEpisode(renderEpisode({ number: 3, scenes: [{ heading: "X", start: 0, end: 7000, beats }] }), "episode-003.txt");
  const m = new Map([[3, e]]);

  it.each([
    [1999, false, /too short/],
    [2000, true, null],
    [6000, true, null],
    [6001, false, /too long/],
  ])("duration %i cs -> ok=%s", (endCs, ok, re) => {
    const r = validateCandidate(cand([seg(e, 0, endCs)]), m);
    expect(r.ok).toBe(ok);
    if (re) expect(r.reasons.join(" ")).toMatch(re);
  });

  it("rejects invalid beat references and mismatched timestamps", () => {
    const s = { ...seg(e, 0, 2000), startBeatId: "E03-B999" };
    expect(validateCandidate(cand([s]), m).reasons.join(" ")).toMatch(/invalid start beat/);
    const t = { ...seg(e, 0, 2000), startCs: 10, startTc: "00:00.10" };
    const r = validateCandidate(cand([t]), m);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not a beat boundary|does not match/);
  });

  it("rejects fabricated timestamp strings even when centiseconds are valid", () => {
    const s = { ...seg(e, 0, 2000), endTc: "00:20.50" };
    expect(validateCandidate(cand([s]), m).reasons.join(" ")).toMatch(/timestamp strings/);
  });

  it("rejects cuts through a dialogue line", () => {
    const s = seg(ep, 0, 3000);
    const bad: Segment = { ...s, endCs: 3500, endTc: "00:35.00" };
    const r = validateCandidate(cand([bad]), eps);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/cuts dialogue/);
  });

  it("rejects missing episodes and wrong stated durations", () => {
    const s = seg(e, 0, 2000);
    expect(validateCandidate(cand([{ ...s, episode: 99 }]), m).reasons.join(" ")).toMatch(/not in pack/);
    expect(validateCandidate({ ...cand([s]), durationCs: 2500 }, m).reasons.join(" ")).toMatch(/stated duration/);
  });

  it("requires multi-segment promos in story order without overlap", () => {
    const e2 = parseEpisode(standardEpisode(2), "episode-002.txt");
    const m2 = new Map([[1, ep], [2, e2]]);
    const a = seg(ep, 0, 1200);
    const b = seg(e2, 5000, 7500);
    expect(validateCandidate(cand([a, b]), m2).ok).toBe(true);
    expect(validateCandidate(cand([b, a]), m2).reasons.join(" ")).toMatch(/story order/);
    const overlapping = seg(ep, 700, 2000);
    expect(validateCandidate(cand([a, overlapping]), m2).reasons.join(" ")).toMatch(/story order or overlap/);
  });

  it("warns about a silent opening", () => {
    const beats2: FixtureBeat[] = [
      { label: "CAMERA", start: 0, end: 500, text: "Slow pan." },
      { label: "ACTION", start: 500, end: 3000, text: "Something happens." },
    ];
    const e2 = parseEpisode(renderEpisode({ number: 4, scenes: [{ heading: "X", start: 0, end: 3000, beats: beats2 }] }), "episode-004.txt");
    const r = validateCandidate(cand([seg(e2, 0, 3000)]), new Map([[4, e2]]));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Silent opening/);
  });
});

describe("AI beat-ID proposals", () => {
  it("rejects invalid, cross-episode and reversed beat IDs instead of guessing", () => {
    const { candidates, decisions } = proposalsToCandidates(ep, [
      { start_beat_id: "E01-B002", end_beat_id: "E01-B013", pitch: "ok" },
      { start_beat_id: "E01-B500", end_beat_id: "E01-B013" },
      { start_beat_id: "E02-B002", end_beat_id: "E02-B013" },
      { start_beat_id: "E01-B013", end_beat_id: "E01-B002" },
    ]);
    expect(candidates).toHaveLength(1);
    expect(decisions).toHaveLength(3);
    expect(decisions.map((d) => d.reasons.join(" ")).join(" ")).toMatch(/invalid beat reference/);
    expect(decisions.some((d) => /precedes/.test(d.reasons.join(" ")))).toBe(true);
    // Timestamps come from the screenplay beats, not from the model.
    const s = candidates[0].segments[0];
    expect(ep.beats.some((b) => b.startCs === s.startCs && b.startTc === s.startTc)).toBe(true);
    expect(ep.beats.some((b) => b.endCs === s.endCs && b.endTc === s.endTc)).toBe(true);
  });
});

describe("heuristic candidates", () => {
  it("only produces valid 20-60 s windows on beat boundaries", () => {
    const wins = enumerateWindows(ep);
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) expect(validateCandidate(cand([w]), eps).ok).toBe(true);
  });

  it("picks non-overlapping top candidates and labels them heuristic", () => {
    const hs = heuristicCandidates(ep, 3);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) {
      expect(h.evaluation.scoreSource).toBe("heuristic");
      expect(h.evaluation.endingResolved).toBeNull();
      expect(h.evaluation.concerns.join(" ")).toMatch(/no AI analysis/);
    }
  });
});
