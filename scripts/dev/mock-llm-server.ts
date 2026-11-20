/**
 * TEST HARNESS ONLY. A local OpenAI-compatible endpoint that returns scripted, schema-valid JSON so
 * the full web AI path (routes, client retries, UI) can be exercised without API keys.
 * Its outputs are NOT AI analysis and must never be presented as such.
 *
 *   npx tsx scripts/dev/mock-llm-server.ts 4010
 *   GEMINI_BASE_URL=http://localhost:4010 AI_PROVIDER=gemini AI_MODEL=mock GEMINI_API_KEY=x npm start
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4010);
const BEAT = /^(E\d+-B\d+) \[(\d\d):(\d\d)\.(\d\d)-(\d\d):(\d\d)\.(\d\d)\] (\S+)/;
let calls = 0;

function propose(user: string) {
  const beats = user.split("\n").map((l) => BEAT.exec(l)).filter(Boolean).map((m) => ({
    id: m![1],
    start: Number(m![2]) * 6000 + Number(m![3]) * 100 + Number(m![4]),
    end: Number(m![5]) * 6000 + Number(m![6]) * 100 + Number(m![7]),
    kind: m![8],
  })).filter((b) => b.kind !== "CAMERA:" && b.kind !== "SOUND:");
  const out = [];
  for (const startAt of [0, 0.45]) {
    const first = beats[Math.floor(beats.length * startAt)];
    if (!first) continue;
    const end = [...beats].reverse().find((b) => b.end - first.start <= 4500 && b.end - first.start >= 2200);
    if (end) out.push({ start_beat_id: first.id, end_beat_id: end.id, hook_beat_id: first.id, cliffhanger_beat_id: end.id, pitch: "Scripted test proposal" });
  }
  out.push({ start_beat_id: "E99-B999", end_beat_id: "E99-B999", hook_beat_id: "x", cliffhanger_beat_id: "y", pitch: "Deliberately invalid reference" });
  return { candidates: out };
}

function judge(user: string) {
  const ids = [...user.matchAll(/=== CANDIDATE (\S+) /g)].map((m) => m[1]);
  return {
    evaluations: ids.map((id, i) => {
      const s = 4 + ((id.length + i) % 5);
      return {
        candidate_id: id,
        scores: { hook: s, cliffhanger: Math.max(3, s - 1), standalone: 6, intensity: s, appeal: s },
        hook: "Scripted test judgment (not AI).",
        cliffhanger: "Scripted test judgment (not AI).",
        why_it_works: "Test harness output.",
        opening_interesting: s >= 5,
        ending_creates_curiosity: s >= 6,
        ending_resolved: false,
        makes_sense_alone: true,
        confusing_references: [],
        concerns: ["test harness"],
        confidence: "low",
      };
    }),
  };
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    // Every 7th call returns a 429 to exercise client/server retry paths.
    if (calls % 7 === 0) {
      res.writeHead(429, { "retry-after": "1", "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const json = JSON.parse(body || "{}");
    const user: string = json.messages?.find((m: { role: string }) => m.role === "user")?.content ?? "";
    const name: string = json.response_format?.json_schema?.name ?? "";
    const content = name === "promo_proposals" ? propose(user) : name === "promo_evaluations" ? judge(user) : { combos: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "mock", choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
}).listen(port, () => console.log(`mock LLM server on ${port}`));
