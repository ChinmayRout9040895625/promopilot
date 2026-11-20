/**
 * Local-only check: parses a real screenplay ZIP and verifies its structure.
 * Prints counts only, never screenplay text.
 * Usage: npm run verify:data -- --zip path/to/pack.zip
 */
import { readFile } from "node:fs/promises";
import { readZipTextFiles } from "../src/core/zip";
import { parsePack } from "../src/core/parse";
import { formatTimecode } from "../src/core/timecode";

const zipArg = process.argv.indexOf("--zip");
if (zipArg < 0 || !process.argv[zipArg + 1]) {
  console.error("Usage: npm run verify:data -- --zip <path>");
  process.exit(2);
}
const buf = await readFile(process.argv[zipArg + 1]);
const { files, skipped } = await readZipTextFiles(buf);
const pack = parsePack(files, skipped);

// Independently re-read every raw "Start: (..) | End: (..)" pair so we can prove the parser kept them all.
const rawPairs = new Map<string, Set<string>>();
for (const f of files) {
  const n = Number(/^episode-0*(\d+)/i.exec(f.fileName)?.[1]);
  const set = new Set<string>();
  for (const m of f.text.matchAll(/Start\s*:\s*\(([^)]*)\)\s*\|\s*End\s*:\s*\(([^)]*)\)/gi)) set.add(`${m[1].trim()}|${m[2].trim()}`);
  rawPairs.set(String(n), set);
}

let beats = 0;
let total = 0;
let tcMismatch = 0;
let notInSource = 0;
const kinds: Record<string, number> = {};
const numberMismatches: string[] = [];
for (const ep of pack.episodes) {
  beats += ep.beats.length;
  total += ep.durationCs;
  const src = rawPairs.get(String(ep.number));
  for (const b of ep.beats) {
    kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    if (formatTimecode(b.startCs) !== b.startTc || formatTimecode(b.endCs) !== b.endTc) tcMismatch++;
    if (!src?.has(`${b.startTc}|${b.endTc}`)) notInSource++;
    if (b.endCs < b.startCs) throw new Error(`${b.id} ends before it starts`);
  }
  const fileNo = Number(/^episode-0*(\d+)/i.exec(ep.fileName)?.[1]);
  if (fileNo !== ep.number) numberMismatches.push(`${ep.fileName} -> ${ep.number}`);
}
console.log(
  JSON.stringify(
    {
      files: files.length,
      skipped: skipped.length,
      episodes: pack.episodes.length,
      errors: pack.errors,
      episodeRange: `${pack.episodes[0]?.number}..${pack.episodes.at(-1)?.number}`,
      contiguous: pack.episodes.every((e, i) => e.number === i + 1),
      numberMismatches,
      beats,
      kinds,
      totalRuntime: formatTimecode(total),
      totalSeconds: total / 100,
      timecodeRoundTripMismatches: tcMismatch,
      beatsWhoseTimestampsAreNotInSource: notInSource,
      episodeWarnings: pack.episodes.filter((e) => e.warnings.length).map((e) => ({ ep: e.number, warnings: e.warnings })),
    },
    null,
    2,
  ),
);
