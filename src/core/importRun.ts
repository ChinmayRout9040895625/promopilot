/**
 * Reads a promos.json export (from the CLI or the web app) back into a RunResult so saved
 * results can be viewed without re-running the model. Nothing is re-scored; values are taken
 * as exported. Timestamps are re-derived from the exported MM:SS.cc strings.
 */
import { z } from "zod";
import type { Episode, Promo, RunResult } from "./types";
import { parseTimecode } from "./timecode";
import { validateCandidate } from "./validate";

const SegmentView = z.object({
  episode: z.number().int(),
  start: z.string(),
  end: z.string(),
  startBeatId: z.string(),
  endBeatId: z.string(),
});

const PromoView = z.object({
  promoId: z.string(),
  rank: z.number().int(),
  headline: z.boolean(),
  status: z.enum(["recommended", "weak", "rejected"]),
  rankReason: z.string().optional(),
  source: z.enum(["heuristic", "ai", "stitch"]),
  candidateId: z.string(),
  arc: z.number().int(),
  totalDurationCs: z.number().int(),
  segments: z.array(SegmentView).min(1),
  scoreSource: z.enum(["ai", "heuristic"]),
  overall: z.number(),
  scores: z.object({ hook: z.number(), cliffhanger: z.number(), standalone: z.number(), intensity: z.number(), appeal: z.number() }),
  hook: z.string(),
  cliffhanger: z.string(),
  whyItWorks: z.string(),
  openingInteresting: z.boolean().nullable(),
  endingCreatesCuriosity: z.boolean().nullable(),
  endingResolved: z.boolean().nullable(),
  makesSenseAlone: z.boolean().nullable(),
  confusingReferences: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  concerns: z.array(z.string()),
  warnings: z.array(z.string()),
  proposerPitch: z.string().optional(),
});

const RunView = z.object({
  meta: z.object({
    pipelineVersion: z.string(),
    promptVersion: z.string(),
    mode: z.enum(["ai", "heuristic"]),
    provider: z.string(),
    model: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    episodesParsed: z.number().int(),
    episodesFailed: z.array(z.number().int()),
    notes: z.array(z.string()),
  }),
  promos: z.array(PromoView),
  decisions: z.array(z.object({ candidateId: z.string(), status: z.enum(["accepted", "rejected"]), reasons: z.array(z.string()) })),
  candidatesConsidered: z.number().int(),
});

export function importRunJson(text: string): RunResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const parsed = RunView.safeParse(raw);
  if (!parsed.success) throw new Error("This file is not a PromoPilot results export (promos.json).");
  const r = parsed.data;
  const promos: Promo[] = r.promos.map((p) => {
    const segments = p.segments.map((s) => ({
      episode: s.episode,
      startBeatId: s.startBeatId,
      endBeatId: s.endBeatId,
      startCs: parseTimecode(s.start),
      endCs: parseTimecode(s.end),
      startTc: s.start,
      endTc: s.end,
    }));
    return {
      id: p.promoId,
      rank: p.rank,
      status: p.status,
      headline: p.headline,
      arc: p.arc,
      rankReason: p.rankReason || undefined,
      warnings: p.warnings,
      candidate: { id: p.candidateId, source: p.source, segments, durationCs: p.totalDurationCs, pitch: p.proposerPitch },
      evaluation: {
        scoreSource: p.scoreSource,
        scores: p.scores,
        overall: p.overall,
        hook: p.hook,
        cliffhanger: p.cliffhanger,
        whyItWorks: p.whyItWorks,
        openingInteresting: p.openingInteresting,
        endingCreatesCuriosity: p.endingCreatesCuriosity,
        endingResolved: p.endingResolved,
        makesSenseAlone: p.makesSenseAlone,
        confusingReferences: p.confusingReferences,
        concerns: p.concerns,
        confidence: p.confidence,
      },
    };
  });
  return { meta: r.meta, promos, decisions: r.decisions, candidatesConsidered: r.candidatesConsidered, rawLlm: [] };
}

/** Re-checks every promo in a loaded run against the uploaded screenplays. */
export function verifyRunAgainst(run: RunResult, episodes: Episode[]): { checked: number; failed: { promoId: string; reasons: string[] }[] } {
  const map = new Map(episodes.map((e) => [e.number, e]));
  const failed: { promoId: string; reasons: string[] }[] = [];
  for (const p of run.promos) {
    const v = validateCandidate(p.candidate, map);
    if (!v.ok) failed.push({ promoId: p.id, reasons: v.reasons });
  }
  return { checked: run.promos.length, failed };
}
