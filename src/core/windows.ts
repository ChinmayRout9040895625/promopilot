import type { Beat, Episode, Segment } from "./types";
import { isContentBeat } from "./parse";
import { HOOK_WINDOW_CS, formatTimecode } from "./timecode";

/** Max distance (cs) we will move a cut to land on a camera shot boundary. */
const SHOT_SNAP_CS = 100;

function straddles(b: Beat, cs: number): boolean {
  return b.startCs < cs && cs < b.endCs;
}

/** A content beat (dialogue/action) that a cut at `cs` would split. */
export function contentBeatCutAt(ep: Episode, cs: number): Beat | undefined {
  return ep.beats.find((b) => isContentBeat(b) && straddles(b, cs));
}

export interface SnapResult {
  segment: Segment;
  adjustments: string[];
}

/**
 * Turns a (start beat, end beat) choice into a segment whose boundaries are exact screenplay
 * beat boundaries and never split a dialogue line or action.
 *  1. start = start beat's start; end = end beat's end.
 *  2. Widen to whole content beats if a cut would split one.
 *  3. Nudge to a camera shot boundary within 1 s, but only if that adds no new content beat.
 * Returns null if the beats are in the wrong order.
 */
export function snapSegment(ep: Episode, startBeat: Beat, endBeat: Beat): SnapResult | null {
  if (startBeat.episode !== ep.number || endBeat.episode !== ep.number) return null;
  let start = startBeat.startCs;
  let end = Math.max(endBeat.endCs, startBeat.endCs);
  if (endBeat.index < startBeat.index || end <= start) return null;
  const adjustments: string[] = [];

  for (let guard = 0; guard < 50; guard++) {
    const cutStart = contentBeatCutAt(ep, start);
    if (!cutStart) break;
    start = cutStart.startCs;
    adjustments.push(`start moved back to include whole ${cutStart.kind} ${cutStart.id}`);
  }
  for (let guard = 0; guard < 50; guard++) {
    const cutEnd = contentBeatCutAt(ep, end);
    if (!cutEnd) break;
    end = cutEnd.endCs;
    adjustments.push(`end extended to finish ${cutEnd.kind} ${cutEnd.id}`);
  }

  // Prefer camera shot boundaries for clean edits.
  const cams = ep.beats.filter((b) => b.kind === "camera");
  const startCam = cams
    .filter((c) => c.startCs <= start && start - c.startCs <= SHOT_SNAP_CS && c.startCs < start)
    .sort((a, b) => b.startCs - a.startCs)[0];
  if (startCam) {
    const s2 = startCam.startCs;
    const addsContent = ep.beats.some((b) => isContentBeat(b) && b.startCs >= s2 && b.startCs < start);
    if (!addsContent && !contentBeatCutAt(ep, s2)) {
      adjustments.push(`start aligned to camera shot ${startCam.id}`);
      start = s2;
    }
  }
  const endCam = cams
    .filter((c) => c.endCs > end && c.endCs - end <= SHOT_SNAP_CS)
    .sort((a, b) => a.endCs - b.endCs)[0];
  if (endCam) {
    const e2 = endCam.endCs;
    const addsContent = ep.beats.some((b) => isContentBeat(b) && b.startCs >= end && b.startCs < e2);
    if (!addsContent && !contentBeatCutAt(ep, e2)) {
      adjustments.push(`end aligned to camera shot ${endCam.id}`);
      end = e2;
    }
  }

  const sb = ep.beats.find((b) => b.startCs === start)!;
  const eb = [...ep.beats].reverse().find((b) => b.endCs === end)!;
  return {
    segment: {
      episode: ep.number,
      startBeatId: sb.id,
      endBeatId: eb.id,
      startCs: start,
      endCs: end,
      startTc: formatTimecode(start),
      endTc: formatTimecode(end),
    },
    adjustments,
  };
}

/** Beats that overlap [startCs, endCs). Content beats are fully inside a valid segment. */
export function beatsInRange(ep: Episode, startCs: number, endCs: number): Beat[] {
  return ep.beats.filter((b) => b.endCs > startCs && b.startCs < endCs);
}

/** Beats a viewer sees/hears in the first 3 seconds of a segment. */
export function firstSeconds(ep: Episode, seg: Segment, windowCs = HOOK_WINDOW_CS): Beat[] {
  return beatsInRange(ep, seg.startCs, Math.min(seg.endCs, seg.startCs + windowCs));
}

/** The next few content beats after the cut (used to check the cut isn't right before the answer). */
export function afterCut(ep: Episode, seg: Segment, count = 2): Beat[] {
  return ep.beats.filter((b) => isContentBeat(b) && b.startCs >= seg.endCs).slice(0, count);
}

export function segmentDuration(seg: Segment): number {
  return seg.endCs - seg.startCs;
}

export function totalDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + segmentDuration(s), 0);
}

export function isBeatStart(ep: Episode, cs: number): boolean {
  return ep.beats.some((b) => b.startCs === cs);
}

export function isBeatEnd(ep: Episode, cs: number): boolean {
  return ep.beats.some((b) => b.endCs === cs);
}

export function isCameraBoundary(ep: Episode, cs: number): boolean {
  return ep.beats.some((b) => b.kind === "camera" && (b.startCs === cs || b.endCs === cs));
}

export function scenesSpanned(ep: Episode, seg: Segment): number[] {
  const set = new Set(beatsInRange(ep, seg.startCs, seg.endCs).filter(isContentBeat).map((b) => b.scene));
  return [...set].sort((a, b) => a - b);
}
