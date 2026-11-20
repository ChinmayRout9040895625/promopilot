import type { Beat, BeatKind, Episode, ParsedPack, Scene } from "./types";
import { formatTimecode, tryParseTimecode } from "./timecode";
import type { TextFile } from "./zip";

const HEADER_RE = /^(EPISODE NUMBER|EPISODE LOGLINE|CONTINUITY NOTES)\s*:\s*(.*)$/i;
const SCENE_RE = /^SCENE\s+(\d+)\b/i;
const SCENE_FIELD_RE = /^SCENE\s+(HEADING|START|END)\s*:\s*(.*)$/i;
const LABEL_RE = /^\*\*(.+?)\*\*\s*$/;
const TIMING_RE = /^Start\s*:\s*\(([^)]*)\)\s*\|\s*End\s*:\s*\(([^)]*)\)/i;
const SCRIPT_MARK_RE = /^---\s*SCRIPT\s+(START|END)\s*---$/i;
const FILE_EP_RE = /^episode[-_ ]?0*(\d+)/i;
const OFFSCREEN_RE = /^(O\.S\.|V\.O\.|O\.C\.|OS|VO)$/i;
const NON_DELIVERY_RE = /^(O\.S\.|V\.O\.|O\.C\.|OS|VO|CONT.D)$/i;

function classify(label: string): BeatKind {
  const head = label.replace(/\(.*$/, "").trim().toUpperCase();
  if (head === "CAMERA" || head === "SHOT") return "camera";
  if (head === "ACTION") return "action";
  if (/^(SOUND FX|SOUND|SFX|MUSIC|AUDIO|SOUND EFFECTS?)$/.test(head)) return "sfx";
  if (/^(TRANSITION|TEXT|TITLE|SUPER|INSERT|NOTE|ON SCREEN TEXT|TEXT ON SCREEN)$/.test(head)) return "other";
  return "dialogue";
}

function parseSpeaker(label: string): { speaker: string; delivery?: string; offscreen: boolean } {
  const speaker = label.replace(/\(.*$/, "").trim();
  const parens = [...label.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const offscreen = parens.some((p) => OFFSCREEN_RE.test(p));
  const deliveryParts = parens.filter((p) => !NON_DELIVERY_RE.test(p));
  return { speaker, delivery: deliveryParts.length ? deliveryParts.join("; ") : undefined, offscreen };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && /^["“]/.test(t) && /["”]$/.test(t)) return t.slice(1, -1).trim();
  return t;
}

interface RawBeat {
  label: string;
  startTc: string;
  endTc: string;
  startCs: number;
  endCs: number;
  text: string[];
  scene: number;
  order: number;
}

/** Parses one screenplay text file. Throws only when the file has no usable beats or no episode number. */
export function parseEpisode(text: string, fileName: string, fallbackNumber?: number): Episode {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const warnings: string[] = [];
  let headerNumber: number | null = null;
  let logline = "";
  let continuity = "";
  const scenes: Scene[] = [];
  const raw: RawBeat[] = [];
  let currentScene = 0;
  let pendingLabel: string | null = null;
  let current: RawBeat | null = null;
  let malformedTiming = 0;
  let invertedTiming = 0;

  const flush = () => {
    if (current) raw.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = HEADER_RE.exec(line);
    if (h) {
      const key = h[1].toUpperCase();
      if (key === "EPISODE NUMBER") {
        const m = /(\d+)/.exec(h[2]);
        headerNumber = m ? Number(m[1]) : null;
      } else if (key === "EPISODE LOGLINE") logline = h[2].trim();
      else continuity = h[2].trim();
      continue;
    }
    if (SCRIPT_MARK_RE.test(line)) {
      flush();
      continue;
    }
    const sf = SCENE_FIELD_RE.exec(line);
    if (sf) {
      flush();
      const scene = scenes[scenes.length - 1];
      if (scene) {
        const field = sf[1].toUpperCase();
        if (field === "HEADING") scene.heading = sf[2].trim();
        else if (field === "START") scene.startCs = tryParseTimecode(sf[2]);
        else scene.endCs = tryParseTimecode(sf[2]);
      }
      continue;
    }
    const sc = SCENE_RE.exec(line);
    if (sc) {
      flush();
      currentScene = Number(sc[1]);
      scenes.push({ number: currentScene, heading: "", startCs: null, endCs: null });
      continue;
    }
    if (/^ACTIONS AND DIALOGUE\s*:?$/i.test(line)) {
      flush();
      continue;
    }
    const lb = LABEL_RE.exec(line);
    if (lb) {
      flush();
      pendingLabel = lb[1].replace(/:\s*$/, "").trim();
      continue;
    }
    const tm = TIMING_RE.exec(line);
    if (tm && pendingLabel !== null) {
      const s = tryParseTimecode(tm[1]);
      const e = tryParseTimecode(tm[2]);
      const label = pendingLabel;
      pendingLabel = null;
      if (s === null || e === null) {
        malformedTiming++;
        continue;
      }
      if (e < s) {
        invertedTiming++;
        continue;
      }
      current = {
        label,
        startTc: tm[1].trim(),
        endTc: tm[2].trim(),
        startCs: s,
        endCs: e,
        text: [],
        scene: currentScene || 1,
        order: raw.length,
      };
      continue;
    }
    if (current) current.text.push(line);
    // Any other stray text outside a beat is ignored.
  }
  flush();

  if (malformedTiming) warnings.push(`${malformedTiming} beat(s) skipped: malformed timestamp`);
  if (invertedTiming) warnings.push(`${invertedTiming} beat(s) skipped: end before start`);

  // Episode number: header is authoritative, filename prefix is the cross-check.
  const fileMatch = FILE_EP_RE.exec(fileName);
  const fileNumber = fileMatch ? Number(fileMatch[1]) : null;
  let number: number;
  if (headerNumber !== null) {
    number = headerNumber;
    if (fileNumber !== null && fileNumber !== headerNumber) {
      warnings.push(`Episode number mismatch: header says ${headerNumber}, filename says ${fileNumber}`);
    }
  } else if (fileNumber !== null) {
    number = fileNumber;
    warnings.push("No EPISODE NUMBER header; used filename");
  } else if (fallbackNumber !== undefined) {
    number = fallbackNumber;
    warnings.push("No episode number in header or filename; used file order");
  } else {
    throw new Error("Cannot determine episode number");
  }

  if (raw.length === 0) throw new Error("No timed beats found");

  // Stable sort by start time; count how many beats moved.
  const sorted = [...raw].sort((a, b) => a.startCs - b.startCs || a.order - b.order);
  const moved = sorted.filter((b, i) => b.order !== i).length;
  if (moved) warnings.push(`${moved} beat(s) reordered by start time (source order was not chronological)`);

  const epTag = `E${String(number).padStart(2, "0")}`;
  const beats: Beat[] = sorted.map((r, i) => {
    const kind = classify(r.label);
    const joined = r.text.join(" ").trim();
    const beat: Beat = {
      id: `${epTag}-B${String(i).padStart(3, "0")}`,
      episode: number,
      index: i,
      kind,
      label: r.label,
      text: kind === "dialogue" ? stripQuotes(joined) : joined,
      startCs: r.startCs,
      endCs: r.endCs,
      // Canonical MM:SS.cc; identical to the source for well-formed screenplays.
      startTc: formatTimecode(r.startCs),
      endTc: formatTimecode(r.endCs),
      scene: r.scene,
    };
    if (kind === "dialogue") {
      const sp = parseSpeaker(r.label);
      beat.speaker = sp.speaker;
      beat.delivery = sp.delivery;
      if (sp.offscreen) beat.offscreen = true;
    }
    return beat;
  });

  const beatEnd = Math.max(...beats.map((b) => b.endCs));
  const sceneEnd = Math.max(0, ...scenes.map((s) => s.endCs ?? 0));
  if (scenes.some((s) => s.startCs === null || s.endCs === null)) {
    warnings.push("Some scenes are missing start/end times");
  }

  return { number, fileName, logline, continuity, scenes, beats, durationCs: Math.max(beatEnd, sceneEnd), warnings };
}

/** Parses all files. Errors are collected per file, never thrown. */
export function parsePack(files: TextFile[], skipped: string[] = []): ParsedPack {
  const episodes: Episode[] = [];
  const errors: ParsedPack["errors"] = [];
  const sortedFiles = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
  sortedFiles.forEach((f, i) => {
    try {
      const ep = parseEpisode(f.text, f.fileName, i + 1);
      if (episodes.some((e) => e.number === ep.number)) {
        errors.push({ fileName: f.fileName, message: `Duplicate episode number ${ep.number}; file ignored` });
        return;
      }
      episodes.push(ep);
    } catch (err) {
      errors.push({ fileName: f.fileName, message: err instanceof Error ? err.message : String(err) });
    }
  });
  episodes.sort((a, b) => a.number - b.number);
  return { episodes, errors, skipped };
}

export function getBeat(ep: Episode, id: string): Beat | undefined {
  const m = /-B(\d+)$/.exec(id);
  if (m) {
    const b = ep.beats[Number(m[1])];
    if (b && b.id === id) return b;
  }
  return ep.beats.find((b) => b.id === id);
}

/** True for beats a viewer hears or sees as story content (not camera directions or sound design). */
export function isContentBeat(b: Beat): boolean {
  return b.kind === "dialogue" || b.kind === "action";
}
