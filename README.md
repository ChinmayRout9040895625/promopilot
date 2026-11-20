# PromoPilot AI

PromoPilot reads a microdrama screenplay pack (a ZIP of episode `.txt` files) and finds the clips worth posting as promos. A promo here is a 20 to 60 second clip that opens on a hook, cuts on a cliffhanger and makes sense to a new viewer. For each promo you get the episode, the exact start and end timestamps of every segment, the hook, the cliffhanger, why it works, a score breakdown and any warnings.

The same TypeScript pipeline runs in two places:

- **Web app** (Next.js, deployable on Vercel). Upload a ZIP, watch progress, review ranked promo cards and download JSON, CSV and a quality report.
- **CLI** for processing a full pack locally and writing the raw output folder.

## How it works

```
ZIP ──► parse (beats with IDs + integer-centisecond times)
    ──► heuristic candidates (rules, always)        ┐
    ──► AI proposals: model picks beat IDs per episode ┤──► snap to beat boundaries ──► validate (hard rules)
                                                     ┘
    ──► AI judge: scores each clip as a first-time viewer ──► gates ──► dedupe ──► rank with diversity ──► exports
```

- **The model never writes timestamps.** It returns beat IDs such as `E12-B034`. Code looks the IDs up, snaps the cut to whole dialogue lines and actions, and rejects any ID that does not exist. Every exported timestamp is an existing screenplay boundary.
- **The judge sees only the clip**, with times relative to the clip start. It gets no episode summaries, which makes it a fair test of standalone clarity. It also sees the two beats after the cut, so it can tell a clean cliffhanger cut from one that lands after the tension resolves.
- **Scoring** weights the criteria: hook 25%, cliffhanger 25%, standalone clarity 20%, emotional intensity 15% and promo appeal 15%. A promo is "weak" if it fails any part of the brief's definition:
  - **hook:** the hook score is below 5, or the judge says the opening 3 seconds are not interesting;
  - **cliffhanger:** the cliffhanger score is below 5, or the ending resolves, or it creates no curiosity;
  - **standalone:** the judge says it does not make sense to a new viewer.

  Weak promos rank below every recommended one.
- **Diversity.** The "post first" list allows at most 2 promos per episode and 4 per 10-episode arc, and no clip that runs on from an earlier pick (less than 10 s apart in the same episode). That makes it cover the whole season.
- **Every rank is explained.** Each promo carries a `rankReason` in the JSON, the CSV and the UI: why it is posted first, which rule held it back, or why it is weak.
- **Multi-segment promos** are optional. A stitched promo is kept only if it beats the best overlapping single clip by at least 0.5.
- **Heuristic mode** works with no API key. It is labelled everywhere as "Heuristic Mode — No AI Analysis", and every result is flagged for human review.

## Requirements

- Node.js 20.12 or newer. Node 22 is recommended.
- An API key for AI mode: Anthropic, Gemini, or any OpenAI-compatible API. Heuristic mode needs no key.

## Setup

```bash
npm install
cp .env.example .env.local     # then edit .env.local
```

### Configuration

All settings are read on the server or by the CLI. Nothing here is sent to the browser.

| Variable | Required | Meaning |
|---|---|---|
| `AI_PROVIDER` | yes | `anthropic`, `gemini`, `openai-compatible` (or `openai`), or `none` (heuristic only) |
| `AI_MODEL` | for AI | Model ID for the chosen provider. The code hardcodes no model names. |
| `ANTHROPIC_API_KEY` | for `anthropic` | Anthropic API key |
| `GEMINI_API_KEY` | for `gemini` | Google AI Studio key, used through Gemini's OpenAI-compatible endpoint |
| `AI_EFFORT` | no | Anthropic reasoning effort: `low`, `medium` or `high`. `low` keeps requests short. |
| `ANTHROPIC_FALLBACKS` | no | Server-side refusal fallbacks, on by default. Set `off` for models that do not support them. |
| `GEMINI_BASE_URL` | no | Override for Gemini's OpenAI-compatible base URL |
| `OPENAI_COMPAT_BASE_URL` | for `openai-compatible` | Base URL of any OpenAI-compatible API, ending before `/chat/completions`. Defaults to OpenAI for `AI_PROVIDER=openai`. |
| `OPENAI_COMPAT_API_KEY` | for `openai-compatible` | Bearer key for that API. `OPENAI_API_KEY` also works. |
| `OPENAI_COMPAT_RESPONSE_FORMAT` | no | `json_schema` (default), `json_object`, or `none`. The last two put the schema in the prompt for servers without native structured output. Replies are always validated with zod. |
| `AI_TIMEOUT_MS` | no | Per-call timeout, default 55000 |
| `APP_ACCESS_CODE` | no | When set, the AI routes require this code, which the UI asks for. Heuristic mode still works without it. |

Example settings for Anthropic:

```
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-5-5
ANTHROPIC_API_KEY=...
AI_EFFORT=low
```

Example settings for Gemini:

```
AI_PROVIDER=gemini
AI_MODEL=<a Gemini model ID available to your key>
GEMINI_API_KEY=...
```

Example settings for any OpenAI-compatible API, such as a model endpoint provided at an interview, a gateway or a local server:

```
AI_PROVIDER=openai-compatible
AI_MODEL=<model ID on that API>
OPENAI_COMPAT_BASE_URL=https://<host>/v1
OPENAI_COMPAT_API_KEY=...
# OPENAI_COMPAT_RESPONSE_FORMAT=json_object   # if the server rejects JSON-schema requests
```

The CLI can switch provider for one run without editing the file, with `--mode anthropic|gemini|openai-compatible|heuristic`.

If the provider is misconfigured, the app falls back to heuristic mode. It shows the reason, for example "ANTHROPIC_API_KEY is not set", and never displays the key.

## Run the web app locally

```bash
npm run dev        # http://localhost:3000
# or a production build:
npm run build && npm start
```

The app is a dashboard with five pages in the sidebar:

| Page | What it shows |
|---|---|
| **Overview** | Upload the ZIP, which is parsed in your browser. Choose **AI analysis** or **Heuristic only** and run, or open saved results. After a run it shows key metrics, an episode-coverage strip you can click, the top post-first promos and the score distribution. |
| **Ranked Promos** | The main view: the ranked list on the left and the selected promo on the right. The detail panel shows the cut timeline, exact timecodes with a copy button, the hook, the cliffhanger, why it works, the written rank reason, the score breakdown, judge verdicts and warnings. You can search and filter by status, arc, source and minimum score, and sort the list. Use `↑`/`↓` to move and `/` to search. Each promo has its own link, such as `#/promos/P003`. |
| **All Candidates** | The decision log: every clip considered and why it was accepted or rejected. It is filterable and sortable, and accepted rows open the promo. |
| **Analytics** | Interactive charts: best score per episode, score distribution with a metric switcher, hook against cliffhanger, the candidate funnel, editor warnings and clip length. Every chart has hover tooltips and a table view. |
| **Reports & Exports** | Download JSON, CSV, the quality report and, for live runs, the JSON with raw AI output. It also shows a rendered preview of the quality report, the run metadata and the server's provider configuration. |

Light, dark and system themes are available from the top bar. Every page works down to phone width.

If some AI calls fail after retries, the affected clips show heuristic estimates and say so. "Retry failed calls" re-runs only what failed, because successful calls are cached in the page.

To view an earlier run without calling the model again, upload the same ZIP and choose **Open saved results**. Then pick its `promos.json`, for example `outputs/final/ai/promos.json` from the CLI. The page re-checks every loaded timestamp against the uploaded screenplays and shows the result.

## Run the full pack from the CLI

```bash
# AI mode, using AI_PROVIDER from .env.local
npm run promos -- --zip "path/to/pack.zip"

# Explicit provider or heuristic only
npm run promos -- --zip pack.zip --mode anthropic
npm run promos -- --zip pack.zip --mode gemini --model <gemini-model-id>
npm run promos -- --zip pack.zip --mode heuristic
```

| Option | Default | Meaning |
|---|---|---|
| `--out <dir>` | `outputs/run-<time>-<mode>` | Output folder |
| `--concurrency <n>` | 3 | Parallel LLM calls |
| `--batch <n>` | 4 | Candidates per judge call |
| `--no-stitch` | | Skip multi-segment promos |
| `--no-cache` | | Ignore the response cache |
| `--raw` | | Embed raw LLM text in `promos.json` |

**Resumable runs.** Every successful LLM response is cached in `.cache/llm/`, keyed by provider, model and prompt. If a run is interrupted or rate-limited, run the same command again and finished calls are reused at no cost. Failed calls are retried with exponential backoff and jitter, and the CLI honours `retry-after`.

The output folder contains:

```
promos.json            ranked promos with segments, scores, explanations, warnings, run metadata
promos.csv             one row per segment (rank, rank_reason, episode, start, end, scores, hook, cliffhanger, ...)
quality_report.md      funnel metrics, pass rates, coverage, arc diversity, AI vs heuristic, review sheet
decisions.jsonl        every candidate accepted or rejected, with reasons
run_meta.json          versions, provider, model, metrics
episodes_summary.json  per-episode parse stats (no screenplay text)
llm_raw/               every raw LLM response, success or failure, unedited
baseline-heuristic/    the heuristic run on the same pack, for comparison (AI mode only)
```

## Verify the results

```bash
npm test                                                   # 86 unit/integration tests
npm run verify:data   -- --zip pack.zip                    # parse all episodes; prints counts only
npm run verify:export -- --zip pack.zip --json out/promos.json --csv out/promos.csv
```

`verify:export` re-reads the raw screenplay text with its own regex, not the parser. It confirms that every exported start is a real `Start:` value and every end a real `End:` value in that episode, and that every promo runs 20 to 60 seconds.

## Deploy on Vercel

1. Push the repository to GitHub. The `.gitignore` keeps out ZIPs, `.txt` screenplays, PDFs, `outputs/`, `.cache/` and `.env*`. Check with `git status` before the first commit.
2. In Vercel, choose **Add New → Project**, import the repo and keep the framework preset **Next.js**.
3. Under **Settings → Environment Variables**, add `AI_PROVIDER`, `AI_MODEL`, the matching API key, optionally `AI_EFFORT=low`, and `APP_ACCESS_CODE` if the URL will be shared.
4. Deploy. Open `/api/status` to confirm the provider and model. The key is never shown.

### Why this fits Vercel's limits

- **No upload to the server.** The ZIP is read in the browser, so the 4.5 MB request-body limit never applies to the pack. Each API request carries one episode, at most about 32 KB for this show, or one judge batch.
- **One LLM call per request.** Each API route does one model call, with `maxDuration = 60`. That is the Hobby plan's limit with legacy functions and below its limit with Fluid compute. A 55-second per-call timeout keeps every request inside it. The browser drives about 100 short requests with a concurrency of 3, and retries rate limits and timeouts with backoff.
- **No filesystem, database or background jobs.** Results live in the browser session until you download them.
- **Assumptions to recheck against current Vercel docs:** the plan's function duration and body-size limits. If a slower model or higher effort pushes calls past 60 seconds, lower `AI_EFFORT`, use a faster model, or reduce the judge batch size in `Workspace.tsx`.

## Confidentiality

- The screenplay pack, extracted text and every output folder are gitignored. Outputs quote screenplay dialogue, so share them only through a private link.
- The deployed app contains no screenplay content. Uploads are parsed in the visitor's browser, and only the episodes being analysed are sent to the API routes and the configured model provider.
- Server code does not log screenplay text. Error messages are written by the app and never echo prompts or keys.
- Set `APP_ACCESS_CODE` on a public deployment so strangers cannot spend your API quota.

## Project layout

```
src/core/            pure TypeScript pipeline shared by web and CLI
  parse.ts zip.ts timecode.ts windows.ts validate.ts heuristic.ts score.ts dedupe.ts rank.ts
  stages.ts          one LLM call per stage (propose / judge / stitch); beat ID → timestamp conversion
  pipeline.ts        orchestration, fallbacks, stitching rule
  export.ts          JSON, CSV, metrics, quality report
  ai/                provider interface, Anthropic + Gemini adapters, retry/cache, schemas, prompts
src/server/          API route handlers (access code, input validation, error mapping)
src/app/             Next.js pages and API routes
src/components/      Workspace (upload, run, results) and PromoCard (cut timeline, scores)
scripts/             CLI, data and export verifiers, dev test harnesses (mock LLM server, UI smoke test)
tests/               Vitest suites with synthetic fixtures (no Kuku content)
docs/                test report (public); docs/private/ holds the solution doc and quality report, which quote screenplay content and are gitignored
```

## Adding another model provider

Implement `LlmProvider` in `src/core/ai/`, which has a `complete(request)` method that returns text. Map its errors to `LlmError` and add a branch in `factory.ts`. Retries, caching, schema validation, prompts and every downstream step are shared. Any OpenAI-compatible API needs no code at all: set `AI_PROVIDER=openai-compatible` and the `OPENAI_COMPAT_*` variables.
