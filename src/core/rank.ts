import type { Promo } from "./types";
import { weakReasons } from "./score";

export interface RankOptions {
  /** Size of the diversity-filtered headline ("post first") list. */
  headlineSize: number;
  maxPerEpisode: number;
  maxPerArc: number;
  /** Episodes per story arc bucket (generic; works for any show). */
  arcSize: number;
  /**
   * Two headline clips from the same episode must be at least this far apart (cs). Stops a clip that
   * simply continues the previous pick's scene from taking a second headline slot.
   */
  minHeadlineGapCs: number;
}

export const DEFAULT_RANK_OPTIONS: RankOptions = { headlineSize: 20, maxPerEpisode: 2, maxPerArc: 4, arcSize: 10, minHeadlineGapCs: 1000 };

export function arcOf(episode: number, arcSize = DEFAULT_RANK_OPTIONS.arcSize): number {
  return Math.ceil(episode / arcSize);
}

const statusOrder = { recommended: 0, weak: 1, rejected: 2 } as const;

/** Sort order: recommended before weak, then overall score, then hook+cliffhanger, then story order. */
export function comparePromos(a: Promo, b: Promo): number {
  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    b.evaluation.overall - a.evaluation.overall ||
    b.evaluation.scores.hook + b.evaluation.scores.cliffhanger - (a.evaluation.scores.hook + a.evaluation.scores.cliffhanger) ||
    a.candidate.segments[0].episode - b.candidate.segments[0].episode ||
    a.candidate.segments[0].startCs - b.candidate.segments[0].startCs
  );
}

/** Smallest gap (cs) between any segments of two promos in the same episode; null if they share no episode. */
export function gapBetween(a: Promo, b: Promo): number | null {
  let best: number | null = null;
  for (const sa of a.candidate.segments) {
    for (const sb of b.candidate.segments) {
      if (sa.episode !== sb.episode) continue;
      const gap = Math.max(sa.startCs, sb.startCs) - Math.min(sa.endCs, sb.endCs);
      best = best === null ? gap : Math.min(best, gap);
    }
  }
  return best;
}

const arcRange = (arc: number, size: number) => `episodes ${(arc - 1) * size + 1} to ${arc * size}`;
const fmt = (n: number) => n.toFixed(2);

type Hold =
  | { kind: "episode"; episode: number }
  | { kind: "arc"; arc: number }
  | { kind: "adjacent"; to: Promo }
  | { kind: "full" };

/**
 * Ranks promos, marks a diversity-filtered headline list and writes a plain-language reason for
 * every rank: why a headline promo is posted first, why a recommended promo was held back, or why a
 * promo is weak. Every promo keeps a rank; non-headline promos stay in the full list.
 */
export function rankPromos(promos: Promo[], opts: Partial<RankOptions> = {}): Promo[] {
  const o = { ...DEFAULT_RANK_OPTIONS, ...opts };
  const sorted = [...promos].sort(comparePromos);
  const perEp = new Map<number, number>();
  const perArc = new Map<number, number>();
  const headlines: Promo[] = [];
  const holds = new Map<Promo, Hold>();

  for (const p of sorted) {
    p.arc = arcOf(p.candidate.segments[0].episode, o.arcSize);
    p.headline = false;
    if (p.status !== "recommended") continue;
    if (headlines.length >= o.headlineSize) {
      holds.set(p, { kind: "full" });
      continue;
    }
    const eps = [...new Set(p.candidate.segments.map((s) => s.episode))];
    const fullEp = eps.find((e) => (perEp.get(e) ?? 0) >= o.maxPerEpisode);
    if (fullEp !== undefined) {
      holds.set(p, { kind: "episode", episode: fullEp });
      continue;
    }
    if ((perArc.get(p.arc) ?? 0) >= o.maxPerArc) {
      holds.set(p, { kind: "arc", arc: p.arc });
      continue;
    }
    const neighbour = headlines.find((h) => {
      const g = gapBetween(p, h);
      return g !== null && g < o.minHeadlineGapCs;
    });
    if (neighbour) {
      holds.set(p, { kind: "adjacent", to: neighbour });
      continue;
    }
    p.headline = true;
    headlines.push(p);
    eps.forEach((e) => perEp.set(e, (perEp.get(e) ?? 0) + 1));
    perArc.set(p.arc, (perArc.get(p.arc) ?? 0) + 1);
  }

  // Headlines first (in score order), then everything else in score order.
  const ordered = [...headlines, ...sorted.filter((p) => !p.headline)];
  ordered.forEach((p, i) => {
    p.rank = i + 1;
    p.id = `P${String(i + 1).padStart(3, "0")}`;
  });

  // Reasons are written after IDs are final so they can refer to other promos.
  const recommended = sorted.filter((p) => p.status === "recommended");
  headlines.forEach((p, i) => {
    const s = p.evaluation.scores;
    const scoreLine = `${fmt(p.evaluation.overall)} overall (hook ${s.hook}, cliffhanger ${s.cliffhanger}, standalone ${s.standalone})`;
    const skipped = recommended.filter((r) => !r.headline && r.evaluation.overall > p.evaluation.overall).length;
    const next = headlines[i + 1];
    const tie = next && next.evaluation.overall === p.evaluation.overall ? " Ties with the next pick on overall score; the higher hook + cliffhanger total goes first." : "";
    p.rankReason =
      i === 0
        ? `Post first: the highest-scoring recommended promo, ${scoreLine}.${tie}`
        : `Post-first pick ${i + 1} of ${headlines.length}: ${scoreLine}${
            skipped ? `. ${skipped} higher-scoring promo${skipped > 1 ? "s were" : " was"} held back by the diversity rules` : ", the next best score"
          }.${tie}`;
  });
  for (const p of sorted) {
    if (p.headline) continue;
    if (p.status !== "recommended") {
      const why = weakReasons(p.evaluation);
      p.rankReason = `Ranked with the weak promos: ${(why.length ? why : ["below the quality gate"]).join("; ").toLowerCase()}.`;
      continue;
    }
    const h = holds.get(p);
    const lead = `Recommended (${fmt(p.evaluation.overall)} overall) but not in the post-first list:`;
    p.rankReason =
      h?.kind === "episode"
        ? `${lead} episode ${h.episode} already has ${o.maxPerEpisode} post-first picks.`
        : h?.kind === "arc"
          ? `${lead} story arc ${h.arc} (${arcRange(h.arc, o.arcSize)}) already has ${o.maxPerArc} post-first picks.`
          : h?.kind === "adjacent"
            ? `${lead} it runs on from post-first pick #${h.to.rank} in the same episode (less than ${o.minHeadlineGapCs / 100} s apart), so it would feel like a repeat.`
            : `${lead} the list of ${o.headlineSize} was already full.`;
  }
  return ordered;
}
