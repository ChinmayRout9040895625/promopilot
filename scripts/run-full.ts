/**
 * PromoPilot CLI: processes a whole screenplay ZIP locally with the same core pipeline as the web app.
 *
 *   npm run promos -- --zip path/to/pack.zip [options]
 *
 * Options:
 *   --mode <env|heuristic|anthropic|gemini|openai-compatible>  Provider (default: env = AI_PROVIDER from .env.local/.env)
 *   --model <id>             Override AI_MODEL
 *   --out <dir>              Output folder (default: outputs/run-<timestamp>-<mode>)
 *   --concurrency <n>        Parallel LLM calls (default 3)
 *   --batch <n>              Candidates per judge call (default 4)
 *   --no-stitch              Skip multi-segment stitching
 *   --no-cache               Ignore and do not write the response cache (.cache/llm)
 *   --raw                    Also embed raw LLM text inside promos.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readZipTextFiles } from "../src/core/zip";
import { parsePack } from "../src/core/parse";
import { runPipeline, type Executors } from "../src/core/pipeline";
import { runJudge, runPropose, runStitch } from "../src/core/stages";
import { providerFromEnv } from "../src/core/ai/factory";
import type { CacheStore, CallOptions } from "../src/core/ai/json";
import { qualityReport, toCsv, toJson, computeMetrics } from "../src/core/export";
import type { RunResult } from "../src/core/types";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      if (existsSync(f)) process.loadEnvFile(f);
    } catch {
      /* ignore malformed env files */
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

class FileCache implements CacheStore {
  constructor(private dir: string) {}
  async get(key: string) {
    const f = path.join(this.dir, `${key}.txt`);
    return existsSync(f) ? readFile(f, "utf8") : undefined;
  }
  async set(key: string, value: string) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${key}.txt`), value, "utf8");
  }
}

async function writeRun(dir: string, run: RunResult, baseline: RunResult | undefined, includeRaw: boolean) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "promos.json"), toJson(run, { includeRaw }), "utf8");
  await writeFile(path.join(dir, "promos.csv"), toCsv(run), "utf8");
  await writeFile(path.join(dir, "quality_report.md"), qualityReport(run, baseline), "utf8");
  await writeFile(path.join(dir, "decisions.jsonl"), run.decisions.map((d) => JSON.stringify(d)).join("\n") + "\n", "utf8");
  await writeFile(path.join(dir, "run_meta.json"), JSON.stringify({ ...run.meta, metrics: computeMetrics(run) }, null, 2), "utf8");
  if (run.rawLlm.length) {
    const rawDir = path.join(dir, "llm_raw");
    await mkdir(rawDir, { recursive: true });
    await Promise.all(
      run.rawLlm.map((r, i) => {
        const tag = r.episode !== undefined ? `E${String(r.episode).padStart(2, "0")}` : (r.candidateIds ?? []).slice(0, 2).join("_");
        return writeFile(path.join(rawDir, `${String(i).padStart(3, "0")}-${r.stage}-${tag}.json`), JSON.stringify(r, null, 2), "utf8");
      }),
    );
  }
}

async function main() {
  loadEnv();
  const zipPath = arg("zip");
  if (!zipPath) {
    console.error("Usage: npm run promos -- --zip <path-to-zip> [--mode env|heuristic|anthropic|gemini|openai-compatible] [--out dir]");
    process.exit(2);
  }
  const modeArg = (arg("mode") ?? "env").toLowerCase();
  const env: Record<string, string | undefined> = { ...process.env };
  if (modeArg === "heuristic" || modeArg === "none") env.AI_PROVIDER = "none";
  else if (["anthropic", "gemini", "openai-compatible", "openai"].includes(modeArg)) env.AI_PROVIDER = modeArg;
  if (arg("model")) env.AI_MODEL = arg("model");

  const cfg = providerFromEnv(env);
  if (modeArg !== "heuristic" && modeArg !== "none" && !cfg.provider) {
    console.error(`AI mode requested but unavailable: ${cfg.reason}. Configure .env.local or run with --mode heuristic.`);
    process.exit(3);
  }

  const buf = await readFile(zipPath);
  const { files, skipped } = await readZipTextFiles(buf);
  const pack = parsePack(files, skipped);
  console.log(`Parsed ${pack.episodes.length} episode(s) from ${files.length} file(s); ${pack.errors.length} error(s).`);
  for (const e of pack.errors) console.log(`  ! ${e.fileName}: ${e.message}`);
  if (!pack.episodes.length) process.exit(4);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = arg("out") ?? path.join("outputs", `run-${stamp}-${cfg.mode === "none" ? "heuristic" : cfg.mode}`);
  const concurrency = Number(arg("concurrency") ?? 3);
  const batch = Number(arg("batch") ?? 4);

  const onProgress = (e: { phase: string; done: number; total: number; message: string; failed?: boolean }) => {
    if (e.phase === "heuristic" && e.done !== e.total) return;
    console.log(`[${e.phase}] ${e.done}/${e.total} ${e.failed ? "FAILED " : ""}${e.message}`);
  };

  // Heuristic baseline (always; cheap and deterministic).
  const heuristic = await runPipeline(pack.episodes, {}, { provider: "none", model: "none", onProgress: (e) => e.phase === "done" && onProgress(e) });
  let run = heuristic;
  let baseline: RunResult | undefined;

  // Live usage/cost tally. Prices are optional env settings (USD per million tokens), never hardcoded.
  const priceIn = Number(env.AI_PRICE_INPUT_PER_MTOK ?? NaN);
  const priceOut = Number(env.AI_PRICE_OUTPUT_PER_MTOK ?? NaN);
  const usage = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  const costOf = () =>
    Number.isFinite(priceIn) && Number.isFinite(priceOut)
      ? Math.round(((usage.inputTokens * priceIn + usage.outputTokens * priceOut) / 1e6) * 10000) / 10000
      : null;
  const usageLine = () => {
    const c = costOf();
    return `usage so far: ${usage.calls} live calls (${usage.failed} failed), ${usage.inputTokens} in / ${usage.outputTokens} out tokens${c !== null ? `, est. $${c.toFixed(4)}` : ""}`;
  };

  if (cfg.provider) {
    const inner = cfg.provider;
    const provider: typeof inner = {
      name: inner.name,
      model: inner.model,
      async complete(req, signal) {
        usage.calls++;
        try {
          const res = await inner.complete(req, signal);
          usage.inputTokens += res.usage?.inputTokens ?? 0;
          usage.outputTokens += res.usage?.outputTokens ?? 0;
          if (usage.calls % 10 === 0) console.log(`  ${usageLine()}`);
          return res;
        } catch (e) {
          usage.failed++;
          throw e;
        }
      },
    };
    const callOpts: CallOptions = { cache: flag("no-cache") ? undefined : new FileCache(path.join(".cache", "llm")) };
    const exec: Executors = {
      propose: (ep) => runPropose(provider, ep, callOpts),
      judge: (cands, eps) => runJudge(provider, cands, eps, callOpts),
      stitch: flag("no-stitch") ? undefined : (src, eps) => runStitch(provider, src, eps, callOpts),
    };
    console.log(`AI mode: ${cfg.mode} / ${cfg.model}; concurrency ${concurrency}, judge batch ${batch}`);
    run = await runPipeline(pack.episodes, exec, {
      provider: cfg.mode,
      model: cfg.model,
      concurrency,
      judgeBatchSize: batch,
      stitch: !flag("no-stitch"),
      onProgress,
    });
    baseline = heuristic;
    await writeRun(path.join(outDir, "baseline-heuristic"), heuristic, undefined, false);
  }

  await writeRun(outDir, run, baseline, flag("raw"));
  if (cfg.provider) {
    await writeFile(
      path.join(outDir, "usage.json"),
      JSON.stringify(
        { ...usage, priceInputPerMTok: Number.isFinite(priceIn) ? priceIn : null, priceOutputPerMTok: Number.isFinite(priceOut) ? priceOut : null, estimatedCostUsd: costOf(), note: "Counts live API attempts this run; cached responses cost nothing and are not counted." },
        null,
        2,
      ),
      "utf8",
    );
    console.log(usageLine());
  }
  await writeFile(
    path.join(outDir, "episodes_summary.json"),
    JSON.stringify(
      {
        files: files.length,
        skipped,
        errors: pack.errors,
        episodes: pack.episodes.map((e) => ({
          episode: e.number,
          file: e.fileName,
          scenes: e.scenes.length,
          beats: e.beats.length,
          durationCs: e.durationCs,
          warnings: e.warnings,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const m = computeMetrics(run);
  console.log(`\nMode: ${run.meta.mode} | promos: ${run.promos.length} (recommended ${m.recommended}, weak ${m.weak}) | episodes covered: ${m.episodesWithRecommended}/${m.episodesTotal}`);
  const fails = run.rawLlm.filter((r) => !r.ok).length;
  if (run.rawLlm.length) console.log(`LLM calls: ${run.rawLlm.length} (${run.rawLlm.filter((r) => r.cached).length} cached, ${fails} failed)`);
  console.log("Top 10 headline promos:");
  for (const p of run.promos.filter((p) => p.headline).slice(0, 10)) {
    const segs = p.candidate.segments.map((s) => `E${s.episode} ${s.startTc}-${s.endTc}`).join(" + ");
    console.log(`  #${p.rank} ${segs} (${(p.candidate.durationCs / 100).toFixed(1)}s) score ${p.evaluation.overall} [${p.evaluation.scoreSource}]`);
  }
  console.log(`\nOutputs written to ${outDir}`);
}

main().catch((e) => {
  console.error(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
