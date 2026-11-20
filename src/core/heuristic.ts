/**
 * Rule-based baseline. Used (a) on its own when no AI provider is configured and
 * (b) as extra candidates for the AI judge in AI mode. Scores are labelled "heuristic"
 * everywhere and every heuristic promo is flagged for human review.
 *
 * Signals are structural (timing, punctuation, delivery notes, episode/scene boundaries,
 * speaker counts), not a list of "dramatic words".
 */
import type { Beat, Candidate, Episode, Evaluation, Scores, Segment } from "./types";
import { isContentBeat } from "./parse";
import { MAX_PROMO_CS, MIN_PROMO_CS } from "./timecode";
import { afterCut, beatsInRange, firstSeconds, scenesSpanned, snapSegment, totalDuration } from "./windows";
import { overallScore } from "./score";
import { overlapRatio } from "./dedupe";

const STRONG_DELIVERY =
  /(furious|shout|scream|desperate|outrag|horrif|gasp|cry|crying|sob|fierce|menac|threat|panic|terrif|rage|enraged|venom|cruel|shock|broken|pleading|begging|commanding|cold|explosive|livid|frantic)/i;
const OPENING_FILLER = /^(and|but|so|then|yes|no|okay|ok|well|he|she|they|it|that|this|him|her|them)\b/i;
const SFX_CUE = /(cliffhanger|ominous|drone|swell|sting|cut to black|silence|heartbeat|thunder)/i;

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
const excerpt = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describeBeat(b: Beat): string {
  if (b.kind === "dialogue") return `${b.speaker}: "${excerpt(b.text)}"`;
  return excerpt(b.text);
}

export interface HeuristicDetail {
  scores: Scores;
  evaluation: Evaluation;
}

export function heuristicEvaluate(ep: Episode, seg: Segment): Evaluation {
  const dur = seg.endCs - seg.startCs;
  const inside = beatsInRange(ep, seg.startCs, seg.endCs);
  const content = inside.filter(isContentBeat);
  const dialogue = content.filter((b) => b.kind === "dialogue");
  const opening = firstSeconds(ep, seg).filter(isContentBeat);
  const firstLine = opening.find((b) => b.kind === "dialogue");
  const lastContent = content[content.length - 1];
  const lastLine = [...dialogue].reverse()[0];

  // Hook: something said or done in the first 3 seconds, and how charged it is.
  let hook = 0;
  if (opening.length) hook += 3;
  if (opening.some((b) => b.kind === "action")) hook += 1.5;
  if (firstLine) {
    if (/[!?]["”]?$/.test(firstLine.text)) hook += 2;
    if (firstLine.delivery && STRONG_DELIVERY.test(firstLine.delivery)) hook += 2;
    if (OPENING_FILLER.test(firstLine.text)) hook -= 1.5;
  }
  const scene = ep.scenes.find((s) => s.startCs !== null && Math.abs(s.startCs - seg.startCs) <= 50);
  if (scene) hook += 1;

  // Cliffhanger: authored episode ending, an open question, a sting in the sound design.
  let cliff = 1;
  const atEpisodeEnd = ep.durationCs - seg.endCs <= 100;
  if (atEpisodeEnd) cliff += 4;
  // The clip should end on its last line (or a reaction shot right after it), not trail off.
  const endsOnLastLine = lastLine && seg.endCs - lastLine.endCs <= 300;
  if (lastLine && endsOnLastLine) {
    if (/(\?|\.\.\.|…|—|-)["”]?$/.test(lastLine.text)) cliff += 2;
    else if (/!["”]?$/.test(lastLine.text)) cliff += 1;
    if (lastLine.delivery && STRONG_DELIVERY.test(lastLine.delivery)) cliff += 1;
  }
  const sfxNearEnd = inside.some((b) => b.kind === "sfx" && seg.endCs - b.endCs <= 200 && SFX_CUE.test(b.text));
  if (sfxNearEnd) cliff += 2;
  if (ep.scenes.some((s) => s.endCs !== null && Math.abs(s.endCs - seg.endCs) <= 50)) cliff += 1.5;
  // A held pause before the next line suggests a suspended moment; an instant reply suggests we cut mid-exchange.
  const next = afterCut(ep, seg, 1)[0];
  if (next && !atEpisodeEnd) {
    const gap = next.startCs - seg.endCs;
    if (gap >= 100) cliff += 1.5;
    else if (gap < 50) cliff -= 1;
  }

  // Standalone: fewer speakers and a clean opening line are easier to follow cold.
  const speakers = new Set(dialogue.map((b) => b.speaker));
  let standalone = 9;
  standalone -= Math.max(0, speakers.size - 2) * 1.2;
  if (firstLine && OPENING_FILLER.test(firstLine.text)) standalone -= 2;
  if (scenesSpanned(ep, seg).length > 1) standalone -= 1;
  if (firstLine?.offscreen) standalone -= 1;
  if (dialogue.length === 0) standalone -= 3;

  // Intensity: density of lines, exclamations, and strongly marked deliveries.
  const density = (dialogue.length / dur) * 1000; // lines per 10 s
  const exclaims = dialogue.filter((b) => /!["”]?$/.test(b.text)).length;
  const charged = dialogue.filter((b) => b.delivery && STRONG_DELIVERY.test(b.delivery)).length;
  const intensity = Math.min(4, density * 1.3) + Math.min(3, exclaims * 0.8) + Math.min(3, charged * 0.6);

  const sweetSpot = dur >= 2800 && dur <= 5000 ? 2 : 1;
  const appeal = 0.4 * clamp(hook) + 0.4 * clamp(cliff) + sweetSpot;

  const scores: Scores = {
    hook: clamp(hook),
    cliffhanger: clamp(cliff),
    standalone: clamp(standalone),
    intensity: clamp(intensity),
    appeal: clamp(appeal),
  };

  const why: string[] = [];
  if (atEpisodeEnd) why.push("ends on the episode's own cliffhanger");
  if (firstLine && /[!?]["”]?$/.test(firstLine.text)) why.push("opens on a charged line");
  if (speakers.size <= 2 && dialogue.length) why.push("few characters to follow");
  if (charged >= 2) why.push("emotionally heated delivery");

  return {
    scoreSource: "heuristic",
    scores,
    overall: overallScore(scores),
    hook: opening.length ? `Opens on: ${describeBeat(opening[0])}` : "No dialogue or action in the first 3 seconds",
    cliffhanger: lastContent
      ? `Ends on: ${describeBeat(lastContent)}${atEpisodeEnd ? " (episode ending)" : ""}`
      : "No content beat at the end",
    whyItWorks: why.length ? `Rule-based: ${why.join("; ")}.` : "Rule-based: no strong structural signals.",
    openingInteresting: null,
    endingCreatesCuriosity: null,
    endingResolved: null,
    makesSenseAlone: null,
    confusingReferences: [],
    concerns: ["Heuristic estimate, no AI analysis: requires human review"],
    confidence: "low",
  };
}

export interface ScoredCandidate {
  candidate: Candidate;
  evaluation: Evaluation;
}

/** Enumerate snapped windows of 20-60 s starting and ending on content beats. */
export function enumerateWindows(ep: Episode): Segment[] {
  const content = ep.beats.filter(isContentBeat);
  const seen = new Set<string>();
  const out: Segment[] = [];
  for (let i = 0; i < content.length; i++) {
    for (let j = i; j < content.length; j++) {
      const raw = content[j].endCs - content[i].startCs;
      if (raw < MIN_PROMO_CS - 200) continue;
      if (raw > MAX_PROMO_CS) break;
      const snapped = snapSegment(ep, content[i], content[j]);
      if (!snapped) continue;
      const s = snapped.segment;
      const d = s.endCs - s.startCs;
      if (d < MIN_PROMO_CS || d > MAX_PROMO_CS) continue;
      const key = `${s.startCs}-${s.endCs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/** Top-K non-overlapping heuristic candidates for one episode. */
export function heuristicCandidates(ep: Episode, perEpisode = 3): ScoredCandidate[] {
  const scored = enumerateWindows(ep).map((seg) => ({ seg, evaluation: heuristicEvaluate(ep, seg) }));
  scored.sort((a, b) => b.evaluation.overall - a.evaluation.overall || a.seg.startCs - b.seg.startCs);
  const picked: ScoredCandidate[] = [];
  for (const s of scored) {
    if (picked.length >= perEpisode) break;
    const cand: Candidate = {
      id: `H-E${String(ep.number).padStart(2, "0")}-${picked.length + 1}`,
      source: "heuristic",
      segments: [s.seg],
      durationCs: totalDuration([s.seg]),
    };
    if (picked.some((p) => overlapRatio(p.candidate, cand) >= 0.3)) continue;
    picked.push({ candidate: cand, evaluation: s.evaluation });
  }
  return picked;
}
