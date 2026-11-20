import type { Candidate, Episode } from "./types";
import { getBeat, isContentBeat } from "./parse";
import { MAX_PROMO_CS, MIN_PROMO_CS, formatTimecode, formatSeconds } from "./timecode";
import {
  contentBeatCutAt,
  firstSeconds,
  isBeatEnd,
  isBeatStart,
  isCameraBoundary,
  scenesSpanned,
  totalDuration,
} from "./windows";

export const MAX_SEGMENTS = 3;
export const MIN_MULTI_SEGMENT_CS = 400;

export interface ValidationResult {
  ok: boolean;
  /** Hard-rule failures. Any reason means the candidate is rejected. */
  reasons: string[];
  /** Soft issues worth a human look. */
  warnings: string[];
}

/**
 * Deterministic validation. Every timestamp in an accepted candidate is proven to be an
 * existing screenplay beat boundary, so no timestamp can be invented by the AI.
 */
export function validateCandidate(c: Candidate, episodes: Map<number, Episode>): ValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const segs = c.segments;

  if (segs.length === 0) reasons.push("no segments");
  if (segs.length > MAX_SEGMENTS) reasons.push(`too many segments (${segs.length} > ${MAX_SEGMENTS})`);

  segs.forEach((s, i) => {
    const label = `segment ${i + 1}`;
    const ep = episodes.get(s.episode);
    if (!ep) {
      reasons.push(`${label}: episode ${s.episode} not in pack`);
      return;
    }
    const sb = getBeat(ep, s.startBeatId);
    const eb = getBeat(ep, s.endBeatId);
    if (!sb) reasons.push(`${label}: invalid start beat reference ${s.startBeatId}`);
    if (!eb) reasons.push(`${label}: invalid end beat reference ${s.endBeatId}`);
    if (sb && sb.startCs !== s.startCs) reasons.push(`${label}: start time does not match beat ${sb.id}`);
    if (eb && eb.endCs !== s.endCs) reasons.push(`${label}: end time does not match beat ${eb.id}`);
    if (!Number.isInteger(s.startCs) || !Number.isInteger(s.endCs)) reasons.push(`${label}: non-integer centiseconds`);
    if (s.endCs <= s.startCs) reasons.push(`${label}: end is not after start`);
    if (s.startCs < 0 || s.endCs > ep.durationCs) reasons.push(`${label}: outside episode bounds`);
    if (!isBeatStart(ep, s.startCs)) reasons.push(`${label}: start ${formatTimecode(Math.max(0, s.startCs))} is not a beat boundary`);
    if (!isBeatEnd(ep, s.endCs)) reasons.push(`${label}: end ${formatTimecode(Math.max(0, s.endCs))} is not a beat boundary`);
    if (s.startTc !== formatTimecode(Math.max(0, s.startCs)) || s.endTc !== formatTimecode(Math.max(0, s.endCs))) {
      reasons.push(`${label}: timestamp strings do not match centiseconds`);
    }
    const cutS = contentBeatCutAt(ep, s.startCs);
    const cutE = contentBeatCutAt(ep, s.endCs);
    if (cutS) reasons.push(`${label}: start cuts ${cutS.kind} ${cutS.id} in half`);
    if (cutE) reasons.push(`${label}: end cuts ${cutE.kind} ${cutE.id} in half`);
    if (segs.length > 1 && s.endCs - s.startCs < MIN_MULTI_SEGMENT_CS) {
      reasons.push(`${label}: shorter than ${formatSeconds(MIN_MULTI_SEGMENT_CS)}`);
    }

    // Soft checks
    if (i === 0) {
      const opening = firstSeconds(ep, s).filter(isContentBeat);
      if (opening.length === 0) warnings.push("Silent opening: no dialogue or action in the first 3 seconds");
    }
    if (!isCameraBoundary(ep, s.startCs) || !isCameraBoundary(ep, s.endCs)) {
      warnings.push(`${label}: a cut is not on a camera shot boundary`);
    }
    if (scenesSpanned(ep, s).length > 1) warnings.push(`${label}: spans a scene change`);
  });

  // Story order and overlap across segments.
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1];
    const b = segs[i];
    if (b.episode < a.episode || (b.episode === a.episode && b.startCs < a.endCs)) {
      reasons.push(`segments ${i} and ${i + 1} are out of story order or overlap`);
    }
  }

  const total = totalDuration(segs);
  if (total !== c.durationCs) reasons.push("stated duration does not match segments");
  if (total < MIN_PROMO_CS) reasons.push(`too short (${formatSeconds(total)} < 20.00s)`);
  if (total > MAX_PROMO_CS) reasons.push(`too long (${formatSeconds(total)} > 60.00s)`);
  if (reasons.length === 0) {
    if (total < 2500) warnings.push("Short promo (under 25 s)");
    if (total > 5500) warnings.push("Long promo (over 55 s)");
  }

  return { ok: reasons.length === 0, reasons, warnings: [...new Set(warnings)] };
}
