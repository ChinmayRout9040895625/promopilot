/**
 * Synthetic screenplay fixtures written for tests. Invented content only; no Kuku material.
 * Format mirrors the input pack: header lines, SCENE blocks, bold labels, Start/End timing lines.
 */
import JSZip from "jszip";
import { formatTimecode } from "../../src/core/timecode";

export interface FixtureBeat {
  label: string;
  start: number; // centiseconds
  end: number;
  text: string;
}

export interface FixtureScene {
  heading: string;
  start: number;
  end: number;
  beats: FixtureBeat[];
}

export function renderEpisode(opts: {
  number: number;
  scenes: FixtureScene[];
  upperCaseSceneLabels?: boolean;
  omitHeaderNumber?: boolean;
  logline?: string;
}): string {
  const out: string[] = [];
  if (!opts.omitHeaderNumber) out.push(`EPISODE NUMBER: Episode ${opts.number}`);
  out.push(`EPISODE LOGLINE: ${opts.logline ?? `Synthetic logline for episode ${opts.number}.`}`);
  out.push(`CONTINUITY NOTES: Synthetic continuity for episode ${opts.number}.`);
  out.push("", "--- SCRIPT START ---", "");
  opts.scenes.forEach((s, i) => {
    const u = opts.upperCaseSceneLabels;
    out.push(`SCENE ${String(i + 1).padStart(2, "0")}`);
    out.push(`${u ? "SCENE HEADING" : "Scene heading"}: ${s.heading}`);
    out.push(`${u ? "SCENE START" : "Scene start"}: ${formatTimecode(s.start)}`);
    out.push(`${u ? "SCENE END" : "Scene end"}: ${formatTimecode(s.end)}`);
    out.push("", u ? "ACTIONS AND DIALOGUE:" : "Actions and dialogue:", "");
    for (const b of s.beats) {
      out.push(`**${b.label}:**`);
      out.push(`Start: (${formatTimecode(b.start)}) | End: (${formatTimecode(b.end)})`);
      out.push(b.text, "");
    }
  });
  out.push("--- SCRIPT END ---");
  return out.join("\n");
}

/**
 * A ~75 second episode with: a camera gap (no camera between 20.00 and 24.00),
 * overlapping dialogue/camera beats, a strong opening line, and a cliffhanger ending.
 */
export function standardEpisode(number: number): string {
  const beats: FixtureBeat[] = [
    { label: "CAMERA", start: 0, end: 300, text: "Wide shot of a rain-soaked harbour at night." },
    { label: "ACTION", start: 50, end: 300, text: "Mara slams a ledger onto the dock table." },
    { label: "MARA (Furious)", start: 100, end: 290, text: '"You sold my father\'s ship!"' },
    { label: "CAMERA", start: 300, end: 700, text: "Close-up on Tobin." },
    { label: "TOBIN (Calm)", start: 320, end: 650, text: '"I sold what was mine to sell."' },
    { label: "CAMERA", start: 700, end: 1200, text: "Two-shot, rain intensifies." },
    { label: "MARA (Shaking)", start: 720, end: 1150, text: '"Then who owns the cargo hold?"' },
    { label: "CAMERA", start: 1200, end: 2000, text: "Push in on Tobin smiling." },
    { label: "TOBIN (Smug)", start: 1250, end: 1900, text: '"Someone you buried."' },
    // Camera gap: 20.00 -> 24.00 has no camera beat.
    { label: "ACTION", start: 2000, end: 2400, text: "Mara steps back, stunned." },
    { label: "CAMERA", start: 2400, end: 3000, text: "Close-up on Mara." },
    { label: "MARA (Whispering)", start: 2450, end: 2950, text: '"That is impossible."' },
    { label: "CAMERA", start: 3000, end: 4000, text: "Wide shot of the dock." },
    { label: "TOBIN (Cold)", start: 3050, end: 3900, text: '"Ask him yourself. He is on the boat."' },
    { label: "CAMERA", start: 4000, end: 5000, text: "Mara turns toward the ship." },
    { label: "ACTION", start: 4000, end: 4800, text: "A hooded figure appears on the deck." },
    { label: "CAMERA", start: 5000, end: 6000, text: "Close-up on the hooded figure." },
    { label: "HOODED FIGURE (Low)", start: 5100, end: 5900, text: '"Hello, Mara."' },
    { label: "CAMERA", start: 6000, end: 7000, text: "Close-up on Mara, horrified." },
    { label: "MARA (Breathless)", start: 6100, end: 6800, text: '"Father?"' },
    { label: "SOUND FX", start: 6800, end: 7500, text: "A low drone rises and cuts to silence." },
    { label: "CAMERA", start: 7000, end: 7500, text: "Cut to black." },
  ];
  return renderEpisode({
    number,
    scenes: [{ heading: "EXT. HARBOUR - NIGHT", start: 0, end: 7500, beats }],
  });
}

export async function buildZip(files: Record<string, string>, folder = "Synthetic Show"): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(`${folder}/${name}`, text);
  zip.file("__MACOSX/._junk.txt", "junk");
  zip.file(`${folder}/readme.md`, "not a screenplay");
  return zip.generateAsync({ type: "uint8array" });
}
