# Test report: PromoPilot AI

Environment: Windows 11, Node 22.16, Next.js 16.4.6, TypeScript 5.9, Vitest 5.1.

## 1. Automated tests: `npm test`

**86 of 86 passing** across 8 suites. The fixtures are synthetic screenplays written for the tests, with no Kuku content.

| Suite | Tests | Covers |
|---|---|---|
| `parse.test.ts` | 15 | Timecode parse and format round-trips, malformed timecodes, upper- and lowercase scene labels, header versus filename episode numbers, fallback numbering, beat reordering, overlapping beats, malformed and inverted timing, off-screen markers, ZIP reading (skips non-`.txt` and `__MACOSX`), duplicate episode numbers |
| `windows-validate.test.ts` | 18 | Snapping to whole lines and camera shots, never cutting a line in half, camera gaps, reversed or cross-episode beats, first-3-second extraction, duration boundaries at **19.99 s (rejected), 20.00 s (ok), 60.00 s (ok) and 60.01 s (rejected)**, invalid beat IDs, fabricated timestamp strings, multi-segment order and overlap, silent-opening warning, invalid AI beat IDs rejected rather than repaired, heuristic windows always valid |
| `dedupe-rank-export.test.ts` | 10 | Overlap ratio, dedupe keeps the higher score and records why, the 25/25/20/15/15 weights, weak gating, recommended ranked before weak, per-episode and per-arc diversity caps, CSV escaping, one CSV row per segment, JSON export, metrics, quality report sections |
| `ai.test.ts` | 15 | JSON extraction, zod validation (out-of-range scores, missing fields), retries with backoff, `retry-after`, no retry on auth errors, one retry on invalid output, cache hits and cache keys per model, provider switching from the environment, no key leakage, the Gemini adapter request shape and its 429, 401 and truncation mapping, Anthropic SDK error-class mapping (429, 401, 404, 500, 529, network) |
| `pipeline.test.ts` | 6 | End to end with a scripted model: heuristic mode labelling, AI mode with hallucinated IDs rejected, ranking, raw output records, judge failure falling back to labelled heuristic estimates, a failed episode proposal not stopping the run, stitching rejected below the +0.5 margin and kept above it |
| `handlers.test.ts` | 6 | API handlers give identical proposals and judgments to the direct CLI path (parity), reject malformed bodies, return a 503 with a reason when AI is unconfigured, enforce the access code, and never put secrets in the status response |
| `gaps.test.ts` | 13 | Stricter gate: each judge verdict (dull opening, no curiosity, not standalone, resolved) makes a promo weak, and heuristic results without verdicts are unaffected. Rank reasons for post-first, held-back (episode cap, adjacency) and weak promos. The 10 s adjacency rule. `rank_reason` in the CSV. The generic OpenAI-compatible provider: configuration, request URL, and the `json_schema`, `json_object` and `none` modes. Gemini as a preset. |
| `import.test.ts` | 3 | Opening a saved `promos.json` round-trips promos, scores and ranks unchanged. Tampered timestamps are caught against the screenplays. Non-export files are rejected. |

## 2. Real input pack

| Check | Command | Result |
|---|---|---|
| Parse all 50 files | `npm run verify:data` | 50 of 50 episodes, 0 errors. Numbers match filename and header. 3,727 beats. 0 parsed timestamps missing from the source. 6 episodes with flagged reordering. |
| Full heuristic run | `npm run promos -- --mode heuristic` | 139 promos (34 recommended) in about 3 s |
| Exported timestamps | `npm run verify:export` | **0 problems** in 139 promos, 139 segments and 139 CSV rows |
| Full AI run (first) | `npm run promos -- --mode anthropic` | `claude-opus-5-5`, effort low. 93 calls, 0 failed, all served by `claude-opus-5-5`. 634k input and 73k output tokens, about $4.00, 4.7 min. 133 promos (91 recommended), 45/50 episodes covered. Archived in `outputs/archive/ai-run1/`. |
| Full AI run (after audit fixes) | same command | 93 of 93 calls served from the cache, so $0.00 and identical model output. Stricter gate and new ranking rules: 133 promos (74 recommended), 42/50 episodes covered. |
| AI run exported timestamps | `npm run verify:export` | **0 problems** in 133 promos and 133 CSV rows. The checker now parses quoted CSV fields properly, because the new `rank_reason` column contains commas. |
| API key leakage in outputs | text search for key-like strings in `outputs/` and `.cache/` | none found |

## 3. Web application

| Check | Result |
|---|---|
| `npm run build` | Passes, with type checks clean and 4 API routes |
| Client bundle scan | No API key names, no `@anthropic-ai/sdk` and no screenplay text in `.next/static` |
| HTTP smoke test on the production server | `/api/status` reports the mode and model, never secrets. A missing or wrong access code gets a 401. Unconfigured AI gets a 503 with a reason. A non-JSON body gets a 400. |
| Dashboard UI tour (`scripts/dev/ui-tour.ts`) on the real ZIP and the final AI results | **46 of 46 checks pass** in light, dark and 390 px mobile layouts. Covered: the empty states of all five pages; parsing; opening saved results with timestamp re-verification; KPI values matching `promos.json` (20 / 74 / 59 / 257); the 50-cell coverage strip; the ranked list and detail panel; click and keyboard selection; deep links; status tabs, search, sort and no-match state; the candidate table filters and links; analytics hover, metric switch, table view and bar click-through; report preview and all downloads; the dark toggle persisting across reload; the mobile drawer and detail sheet; no horizontal overflow on any page; a heuristic run in the browser; no console errors. |
| Live AI run through the dashboard against the mock OpenAI-compatible server | All 50 episodes proposed through `/api/propose`, judge batches through `/api/judge`, injected 429s retried with no lost episodes, all four exports downloaded, 0 timestamp problems in the 129 exported promos |

The mock server (`scripts/dev/mock-llm-server.ts`) returns scripted, schema-valid JSON. It tests the plumbing only, and its scores are not AI analysis.

## 4. Not yet verified

- **The AI path in the deployed web app with a real key.** The CLI ran it with Claude. The web path has run end to end only against the mock server.
- **Gemini or any other OpenAI-compatible API with a real key.** Only the Anthropic provider has been run live. The generic adapter is covered by unit tests and the mock server.
- **The Gemini OpenAI-compatible endpoint's acceptance of the JSON-schema `response_format`.** The adapter strips `$schema` and `additionalProperties`, but it has not been called against the live endpoint. If Google rejects the schema, the error appears as `bad_request` in `llm_raw/`.
- **Deployment on Vercel itself.** The build is verified locally; the function limits are assumptions documented in the README.
