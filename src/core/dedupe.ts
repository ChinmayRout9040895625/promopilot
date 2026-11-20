import type { Candidate } from "./types";

/**
 * Overlap between two candidates: shared screen time divided by the shorter candidate's duration.
 * 1.0 means one is contained in the other.
 */
export function overlapRatio(a: Candidate, b: Candidate): number {
  let shared = 0;
  for (const sa of a.segments) {
    for (const sb of b.segments) {
      if (sa.episode !== sb.episode) continue;
      const lo = Math.max(sa.startCs, sb.startCs);
      const hi = Math.min(sa.endCs, sb.endCs);
      if (hi > lo) shared += hi - lo;
    }
  }
  const shorter = Math.min(a.durationCs, b.durationCs);
  return shorter > 0 ? shared / shorter : 0;
}

export const DUPLICATE_THRESHOLD = 0.5;

export interface DedupeItem {
  candidate: Candidate;
  score: number;
}

/**
 * Greedy dedupe: keep the highest scoring candidate, drop any later candidate that overlaps a kept
 * one by >= threshold. Returns kept items and the reason each dropped item was removed.
 */
export function dedupe<T extends DedupeItem>(
  items: T[],
  threshold = DUPLICATE_THRESHOLD,
): { kept: T[]; dropped: { item: T; duplicateOf: string; overlap: number }[] } {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const kept: T[] = [];
  const dropped: { item: T; duplicateOf: string; overlap: number }[] = [];
  for (const it of sorted) {
    let dup: { id: string; r: number } | null = null;
    for (const k of kept) {
      const r = overlapRatio(it.candidate, k.candidate);
      if (r >= threshold) {
        dup = { id: k.candidate.id, r };
        break;
      }
    }
    if (dup) dropped.push({ item: it, duplicateOf: dup.id, overlap: Math.round(dup.r * 100) / 100 });
    else kept.push(it);
  }
  return { kept, dropped };
}
