/**
 * Timecodes in the screenplay are "MM:SS.cc" (minutes, seconds, centiseconds).
 * All arithmetic uses integer centiseconds to avoid floating point drift.
 */

const TC_RE = /^(\d{1,3}):([0-5]\d)\.(\d{1,2})$/;

export function parseTimecode(tc: string): number {
  const m = TC_RE.exec(tc.trim());
  if (!m) throw new Error(`Invalid timecode: "${tc}"`);
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  // A single fractional digit means tenths: "05.8" = 5 s 80 cs.
  const frac = m[3].length === 1 ? Number(m[3]) * 10 : Number(m[3]);
  return minutes * 6000 + seconds * 100 + frac;
}

export function tryParseTimecode(tc: string): number | null {
  try {
    return parseTimecode(tc);
  } catch {
    return null;
  }
}

export function formatTimecode(cs: number): string {
  if (!Number.isInteger(cs) || cs < 0) throw new Error(`Invalid centiseconds: ${cs}`);
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const frac = cs % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

/** Human readable seconds, e.g. 4250 -> "42.50s". */
export function formatSeconds(cs: number): string {
  return `${(cs / 100).toFixed(2)}s`;
}

export const MIN_PROMO_CS = 2000;
export const MAX_PROMO_CS = 6000;
export const HOOK_WINDOW_CS = 300;
