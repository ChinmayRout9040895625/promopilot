/** Core domain types shared by the web app, API routes and CLI. Pure TypeScript, no runtime deps. */

export type BeatKind = "camera" | "action" | "dialogue" | "sfx" | "other";

export interface Beat {
  /** Stable ID, e.g. "E12-B034". The only handle the AI may use to reference screenplay moments. */
  id: string;
  episode: number;
  /** Position after sorting by start time (0-based). */
  index: number;
  kind: BeatKind;
  /** Raw bold label without trailing colon, e.g. "MARA (Outraged, Accusing)". */
  label: string;
  speaker?: string;
  delivery?: string;
  offscreen?: boolean;
  text: string;
  startCs: number;
  endCs: number;
  /** Original timestamp strings from the screenplay. */
  startTc: string;
  endTc: string;
  scene: number;
}

export interface Scene {
  number: number;
  heading: string;
  startCs: number | null;
  endCs: number | null;
}

export interface Episode {
  number: number;
  fileName: string;
  logline: string;
  continuity: string;
  scenes: Scene[];
  beats: Beat[];
  durationCs: number;
  /** Non-fatal parse observations (e.g. reordered beats). Never contain screenplay text. */
  warnings: string[];
}

export interface ParseError {
  fileName: string;
  message: string;
}

export interface ParsedPack {
  episodes: Episode[];
  errors: ParseError[];
  /** Files skipped because they are not screenplay text files. */
  skipped: string[];
}

export interface Segment {
  episode: number;
  startBeatId: string;
  endBeatId: string;
  startCs: number;
  endCs: number;
  startTc: string;
  endTc: string;
}

export type CandidateSource = "heuristic" | "ai" | "stitch";

export interface Candidate {
  id: string;
  source: CandidateSource;
  segments: Segment[];
  durationCs: number;
  /** Beat IDs suggested as hook / cliffhanger by the proposer, when available. */
  hookBeatId?: string;
  cliffhangerBeatId?: string;
  pitch?: string;
}

export interface Scores {
  hook: number;
  cliffhanger: number;
  standalone: number;
  intensity: number;
  appeal: number;
}

export type ScoreSource = "ai" | "heuristic";

export interface Evaluation {
  scoreSource: ScoreSource;
  scores: Scores;
  overall: number;
  hook: string;
  cliffhanger: string;
  whyItWorks: string;
  /** null = not assessed (heuristic mode cannot judge these honestly). */
  openingInteresting: boolean | null;
  endingCreatesCuriosity: boolean | null;
  endingResolved: boolean | null;
  makesSenseAlone: boolean | null;
  confusingReferences: string[];
  concerns: string[];
  confidence: "low" | "medium" | "high";
}

export type PromoStatus = "recommended" | "weak" | "rejected";

export interface Decision {
  candidateId: string;
  status: "accepted" | "rejected";
  reasons: string[];
}

export interface Promo {
  id: string;
  rank: number;
  status: PromoStatus;
  candidate: Candidate;
  evaluation: Evaluation;
  warnings: string[];
  /** True when this promo appears in the diversity-filtered headline list. */
  headline: boolean;
  arc: number;
  /** Plain-language reason for this rank (why posted first, held back, or weak). */
  rankReason?: string;
}

export interface RunMeta {
  pipelineVersion: string;
  promptVersion: string;
  mode: "ai" | "heuristic";
  provider: string;
  model: string;
  startedAt: string;
  finishedAt?: string;
  episodesParsed: number;
  episodesFailed: number[];
  notes: string[];
}

export interface RunResult {
  meta: RunMeta;
  promos: Promo[];
  decisions: Decision[];
  candidatesConsidered: number;
  rawLlm: RawLlmRecord[];
}

export interface RawLlmRecord {
  stage: "propose" | "judge" | "stitch";
  key: string;
  provider: string;
  model: string;
  episode?: number;
  candidateIds?: string[];
  rawText: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  cached: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Model the provider says actually served the call; can differ from `model` if a refusal fallback ran. */
  servedModel?: string;
}
