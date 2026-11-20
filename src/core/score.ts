import type { Evaluation, PromoStatus, Scores } from "./types";

export const WEIGHTS: Scores = { hook: 0.25, cliffhanger: 0.25, standalone: 0.2, intensity: 0.15, appeal: 0.15 };

/** Minimum hook / cliffhanger score (0-10) for a promo to be "recommended" rather than "weak". */
export const GATE = 5;

const clamp = (n: number) => Math.max(0, Math.min(10, n));

export function overallScore(s: Scores): number {
  const v =
    WEIGHTS.hook * clamp(s.hook) +
    WEIGHTS.cliffhanger * clamp(s.cliffhanger) +
    WEIGHTS.standalone * clamp(s.standalone) +
    WEIGHTS.intensity * clamp(s.intensity) +
    WEIGHTS.appeal * clamp(s.appeal);
  return Math.round(v * 100) / 100;
}

/**
 * Gating rules, matching the brief's definition of a good promo. A promo is "weak" (never
 * "recommended") if it fails any of: hook, cliffhanger, or standalone sense. Numeric scores and
 * the judge's explicit yes/no verdicts both count; heuristic mode has no verdicts (null) and is
 * gated on scores only.
 */
export function weakReasons(e: Evaluation): string[] {
  const r: string[] = [];
  if (e.scores.hook < GATE) r.push(`Weak hook (${e.scores.hook}/10)`);
  if (e.openingInteresting === false) r.push("Weak hook: opening 3 seconds judged uninteresting");
  if (e.scores.cliffhanger < GATE) r.push(`Weak cliffhanger (${e.scores.cliffhanger}/10)`);
  if (e.endingResolved === true) r.push("Ending appears resolved");
  if (e.endingCreatesCuriosity === false) r.push("Weak cliffhanger: ending judged not to create curiosity");
  if (e.makesSenseAlone === false) r.push("Does not make sense to a new viewer");
  return r;
}

export function statusFor(e: Evaluation): { status: PromoStatus; warnings: string[] } {
  const warnings = weakReasons(e);
  if (e.confusingReferences.length) warnings.push(`Confusing references: ${e.confusingReferences.join(", ")}`);
  if (e.confidence === "low" && e.scoreSource === "ai") warnings.push("Low confidence: needs human review");
  return { status: weakReasons(e).length ? "weak" : "recommended", warnings };
}
