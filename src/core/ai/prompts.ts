import type { Beat, Candidate, Episode } from "../types";
import { formatTimecode } from "../timecode";
import { afterCut, beatsInRange, firstSeconds } from "../windows";
import { isContentBeat } from "../parse";

export const PROMPT_VERSION = "2026-11-20.2";

const PROMO_DEFINITION = `A promo is a 20 to 60 second clip cut from a vertical microdrama and posted on TikTok, Instagram Reels or YouTube Shorts to pull in NEW viewers. A good promo:
- opens on a hook: something in the first 3 seconds that makes a scrolling viewer stop (a slap, a reveal, a shocking line, a sharp confrontation);
- ends on a cliffhanger: it cuts at an unresolved moment so the viewer needs to know what happens next;
- makes sense on its own to someone who has never seen the show.`;

function kindTag(b: Beat): string {
  switch (b.kind) {
    case "dialogue":
      return `${b.speaker}${b.offscreen ? " (O.S.)" : ""}${b.delivery ? ` (${b.delivery})` : ""}:`;
    case "camera":
      return "CAMERA:";
    case "action":
      return "ACTION:";
    case "sfx":
      return "SOUND:";
    default:
      return `${b.label.toUpperCase()}:`;
  }
}

export function renderBeat(b: Beat, relativeToCs?: number): string {
  const time =
    relativeToCs === undefined
      ? `[${b.startTc}-${b.endTc}]`
      : `[+${formatTimecode(Math.max(0, b.startCs - relativeToCs))}]`;
  const text = b.kind === "dialogue" ? `"${b.text}"` : b.text;
  return `${b.id} ${time} ${kindTag(b)} ${text}`;
}

// ---------------------------------------------------------------- propose

export const PROPOSE_SYSTEM = `You are a senior promo editor for a microdrama streaming app.

${PROMO_DEFINITION}

You will receive one episode's screenplay as a list of beats. Each beat has an ID, a time range [MM:SS.cc-MM:SS.cc], a type, and its text. CAMERA lines describe shots; ACTION lines describe what happens; named lines are dialogue.

Your job: propose the strongest promo clips from THIS episode.

Rules:
- Reference moments ONLY by beat IDs from the list. Never write timestamps; code computes them from the IDs.
- start_beat_id is where the clip starts. The hook must land within 3 seconds of that beat's start time. Prefer starting on the line or action that IS the hook, not on set-up before it.
- end_beat_id is where the clip cuts. Cut right after the unresolved moment, before any answer or resolution.
- The clip from the start of start_beat_id to the end of end_beat_id must be between 20 and 60 seconds. Check the times.
- Look across the WHOLE episode. Do not only propose the ending.
- Prefer one continuous stretch. Propose 2 to 4 clips that do not overlap much. If nothing in the episode works, return an empty list.
- Judge the actual sequence of events, not whether the text contains dramatic words.
- A new viewer must be able to follow the clip without knowing earlier episodes.`;

export function proposeUserPrompt(ep: Episode): string {
  return [
    `EPISODE ${ep.number} (duration ${formatTimecode(ep.durationCs)})`,
    ep.logline ? `Episode summary (for your understanding only; the viewer will not see it): ${ep.logline}` : "",
    "",
    "BEATS:",
    ...ep.beats.map((b) => renderBeat(b)),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------------------------------------------------------------- judge

export const JUDGE_SYSTEM = `You are a strict promo quality judge for a microdrama streaming app.

${PROMO_DEFINITION}

Evaluate each candidate clip AS SOMEONE WHO HAS NEVER SEEN THE SHOW. You see only what the viewer would see: the beats inside the clip, with times relative to the clip start (+MM:SS.cc). You get no episode summaries and must not assume knowledge of earlier events.

For each candidate you also see up to two beats AFTER THE CUT. The viewer does not see them. Use them only to check whether the clip cuts right before an answer (a well-placed cut) or after the tension has already been resolved.

Score each criterion 0-10 (integers):
- hook: does the first 3 seconds stop a scroller? A silent establishing shot or mid-conversation filler scores low.
- cliffhanger: does the last moment leave an urgent unresolved question? A resolved or calm ending scores low.
- standalone: can a new viewer follow who is who and what is at stake? Many unexplained names, places or past events score low.
- intensity: emotional charge of the sequence as a whole.
- appeal: overall likelihood a viewer watches to the end and wants the show.
Calibration: 9-10 exceptional, 7-8 strong, 5-6 usable, 3-4 weak, 0-2 unusable. Most clips should land between 4 and 7. Do not reward a clip because it contains dramatic words; judge what actually happens on screen.

Return one evaluation per candidate, using the exact candidate_id given.`;

export interface JudgeContext {
  candidate: Candidate;
  episodes: Map<number, Episode>;
}

export function renderCandidateForJudge({ candidate, episodes }: JudgeContext): string {
  const lines: string[] = [`=== CANDIDATE ${candidate.id} (duration ${(candidate.durationCs / 100).toFixed(1)} s, ${candidate.segments.length} segment(s)) ===`];
  let offset = 0;
  candidate.segments.forEach((seg, i) => {
    const ep = episodes.get(seg.episode);
    if (!ep) return;
    const base = seg.startCs - offset;
    if (i === 0) {
      lines.push("FIRST 3 SECONDS:");
      const first = firstSeconds(ep, seg);
      lines.push(...(first.length ? first.map((b) => renderBeat(b, base)) : ["(nothing)"]));
    }
    if (candidate.segments.length > 1) lines.push(`-- segment ${i + 1} (hard cut) --`);
    lines.push(i === 0 ? "FULL CLIP:" : "");
    lines.push(...beatsInRange(ep, seg.startCs, seg.endCs).map((b) => renderBeat(b, base)));
    offset += seg.endCs - seg.startCs;
  });
  const last = candidate.segments[candidate.segments.length - 1];
  const lastEp = episodes.get(last.episode);
  if (lastEp) {
    const after = afterCut(lastEp, last).filter(isContentBeat);
    lines.push("AFTER THE CUT (not shown to the viewer):");
    lines.push(...(after.length ? after.map((b) => renderBeat(b, last.startCs)) : ["(end of episode)"]));
  }
  return lines.filter((l) => l !== "").join("\n");
}

export function judgeUserPrompt(contexts: JudgeContext[]): string {
  return [`Evaluate these ${contexts.length} candidate promo clip(s).`, "", ...contexts.map(renderCandidateForJudge)].join("\n\n");
}

// ---------------------------------------------------------------- stitch

export const STITCH_SYSTEM = `You are a senior promo editor for a microdrama streaming app.

${PROMO_DEFINITION}

Usually the best promo is one continuous stretch. Sometimes joining 2 or 3 moments works better, for example a shocking hook from one scene followed by the cliffhanger from a later scene.

You will receive strong single-clip promos found earlier, each listed with its beats. Propose up to 5 multi-segment promos ONLY where joining moments would clearly beat every continuous clip. If none would, return an empty list.

Rules:
- Use only beat IDs shown. Never write timestamps.
- Segments must be in story order (earlier episode or earlier time first) and must not overlap.
- Total length of all segments: 20 to 60 seconds. Each segment at least 4 seconds.
- The first segment must open on the hook; the last segment must end on the cliffhanger.
- The result must make sense to a new viewer even with the hard cuts.`;

export function stitchUserPrompt(contexts: JudgeContext[]): string {
  return contexts
    .map(({ candidate, episodes }) => {
      const parts = candidate.segments.map((seg) => {
        const ep = episodes.get(seg.episode)!;
        return beatsInRange(ep, seg.startCs, seg.endCs)
          .map((b) => renderBeat(b))
          .join("\n");
      });
      return `=== CLIP ${candidate.id} (episode ${candidate.segments[0].episode}) ===\n${parts.join("\n")}`;
    })
    .join("\n\n");
}
