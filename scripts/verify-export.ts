/**
 * Independent check that no timestamp in an export was fabricated.
 * Re-reads the raw screenplay text (regex only, not the parser) and confirms that every segment's
 * start is a beat "Start:" value and every end is a beat "End:" value in that episode's file,
 * that durations are 20-60 s, and that segments are in story order.
 *
 *   npx tsx scripts/verify-export.ts --zip pack.zip --json promos.json [--csv promos.csv]
 */
import { readFile } from "node:fs/promises";
import { readZipTextFiles } from "../src/core/zip";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
/** RFC 4180 CSV parser: quoted fields may contain commas, doubled quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const toCs = (tc: string) => {
  const m = /^(\d+):(\d\d)\.(\d\d)$/.exec(tc);
  if (!m) throw new Error(`bad timecode ${tc}`);
  return Number(m[1]) * 6000 + Number(m[2]) * 100 + Number(m[3]);
};

const { files } = await readZipTextFiles(await readFile(arg("zip")!));
const starts = new Map<number, Set<string>>();
const ends = new Map<number, Set<string>>();
for (const f of files) {
  const ep = Number(/EPISODE NUMBER:\s*Episode\s*(\d+)/i.exec(f.text)?.[1] ?? /^episode-0*(\d+)/i.exec(f.fileName)?.[1]);
  const s = new Set<string>();
  const e = new Set<string>();
  for (const m of f.text.matchAll(/Start\s*:\s*\((\d+:\d\d\.\d\d)\)\s*\|\s*End\s*:\s*\((\d+:\d\d\.\d\d)\)/g)) {
    s.add(m[1]);
    e.add(m[2]);
  }
  starts.set(ep, s);
  ends.set(ep, e);
}

const problems: string[] = [];
let segments = 0;
const json = JSON.parse(await readFile(arg("json")!, "utf8"));
for (const p of json.promos) {
  let total = 0;
  let prev: { ep: number; end: number } | null = null;
  for (const s of p.segments) {
    segments++;
    if (!starts.get(s.episode)?.has(s.start)) problems.push(`${p.promoId}: start ${s.start} is not a beat start in episode ${s.episode}`);
    if (!ends.get(s.episode)?.has(s.end)) problems.push(`${p.promoId}: end ${s.end} is not a beat end in episode ${s.episode}`);
    const a = toCs(s.start);
    const b = toCs(s.end);
    if (b <= a) problems.push(`${p.promoId}: end before start`);
    if (prev && (s.episode < prev.ep || (s.episode === prev.ep && a < prev.end))) problems.push(`${p.promoId}: segments out of order/overlap`);
    prev = { ep: s.episode, end: b };
    total += b - a;
  }
  if (total < 2000 || total > 6000) problems.push(`${p.promoId}: total ${total / 100}s outside 20-60 s`);
  if (total !== p.totalDurationCs) problems.push(`${p.promoId}: stated duration mismatch`);
}

const csvPath = arg("csv");
let csvRows = 0;
if (csvPath) {
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const head = rows[0];
  const iEp = head.indexOf("episode");
  const iS = head.indexOf("start");
  const iE = head.indexOf("end");
  for (const cells of rows.slice(1)) {
    csvRows++;
    const ep = Number(cells[iEp]);
    if (!starts.get(ep)?.has(cells[iS])) problems.push(`CSV: start ${cells[iS]} not a beat start in episode ${ep}`);
    if (!ends.get(ep)?.has(cells[iE])) problems.push(`CSV: end ${cells[iE]} not a beat end in episode ${ep}`);
  }
}

console.log(JSON.stringify({ promos: json.promos.length, segments, csvRows, problems: problems.length, examples: problems.slice(0, 10) }, null, 2));
process.exit(problems.length ? 1 : 0);
