"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/components/app/store";
import { Alert, Badge, Button, Card, EmptyState, Icon, Spinner, Stat, StatusBadge } from "@/components/app/ui";
import { EpisodeStrip, Legend, StackedHistogram } from "@/components/charts/charts";
import { episodeStats, epLabel, histogram, secs, timeLabel } from "@/lib/derive";

function useFilePicker(accept: string, onFile: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-label={accept.includes("zip") ? "Upload a screenplay ZIP" : "Open a saved promos.json results file"}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

function Dropzone() {
  const s = useStore();
  const [drag, setDrag] = useState(false);
  const zip = useFilePicker(".zip,application/zip", (f) => void s.loadFile(f));
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a screenplay ZIP"
      onClick={zip.open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && zip.open()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void s.loadFile(f);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        drag ? "border-teal-strong bg-teal-soft" : "border-line-strong bg-surface hover:border-teal-strong"
      }`}
    >
      {zip.input}
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-navy-soft text-navy">
        {s.parsing ? <Spinner size={20} /> : <Icon name="upload" size={22} />}
      </div>
      <p className="text-[15px] font-semibold text-ink">{s.parsing ? "Reading screenplays…" : "Drop the screenplay ZIP here"}</p>
      <p className="mt-1 text-sm text-muted">or click to choose a .zip of episode .txt files</p>
      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-subtle">
        <Icon name="shield" size={13} />
        Opened in your browser. Only episodes being analysed are sent to the server for AI scoring.
      </p>
    </div>
  );
}

function SetupPanel({ compact }: { compact: boolean }) {
  const s = useStore();
  const zip = useFilePicker(".zip,application/zip", (f) => void s.loadFile(f));
  const saved = useFilePicker(".json,application/json", (f) => void s.openSaved(f));
  const [expanded, setExpanded] = useState(!compact);
  useEffect(() => {
    if (s.run) setExpanded(false);
  }, [s.run]);
  const pack = s.pack!;
  const totals = useMemo(() => {
    const beats = pack.episodes.reduce((a, e) => a + e.beats.length, 0);
    const runtime = pack.episodes.reduce((a, e) => a + e.durationCs, 0);
    return { beats, runtime, warned: pack.episodes.filter((e) => e.warnings.length) };
  }, [pack]);
  const hours = Math.floor(totals.runtime / 360000);
  const mins = Math.floor((totals.runtime % 360000) / 6000);
  const show = expanded || s.running || !s.run;
  const runLabel = s.running ? "Finding promos…" : s.loaded ? "Run a new analysis" : s.run ? "Run again" : `Find promos in ${pack.episodes.length} episodes`;
  const needCode = s.aiChosen && Boolean(s.status?.accessCodeRequired) && !s.accessCode;
  return (
    <Card>
      {zip.input}
      {saved.input}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-navy">
            <Icon name="film" size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink" title={s.fileName ?? ""}>
              {s.fileName}
            </p>
            <p className="tc text-xs text-muted">
              {pack.episodes.length} episodes · {pack.episodes[0]?.number}–{pack.episodes.at(-1)?.number} · {hours ? `${hours} h ` : ""}
              {mins} min · {totals.beats.toLocaleString()} timed beats
              {pack.errors.length > 0 && <span className="text-danger"> · {pack.errors.length} file error(s)</span>}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon="upload" onClick={zip.open} disabled={s.running}>
            New ZIP
          </Button>
          <Button size="sm" icon="folder" onClick={saved.open} disabled={s.running}>
            Open saved results
          </Button>
          {s.run && !s.running && (
            <Button size="sm" variant="ghost" icon={expanded ? "chevronUp" : "chevronDown"} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? "Hide run options" : "Run options"}
            </Button>
          )}
        </div>
      </div>

      {show && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <fieldset disabled={s.running} className="grid gap-3 md:grid-cols-2">
            <legend className="sr-only">Analysis mode</legend>
            <label className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${s.aiChosen ? "border-teal-strong bg-teal-soft/50" : "border-line"} ${s.aiAvailable ? "" : "cursor-not-allowed opacity-60"}`}>
              <input type="radio" name="mode" className="mt-1 accent-[var(--teal-strong)]" checked={s.aiChosen} disabled={!s.aiAvailable} onChange={() => s.setUseAi(true)} />
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon name="sparkle" size={14} className="text-teal" /> AI analysis
                  {s.aiAvailable && <Badge tone="teal">{s.status?.model}</Badge>}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted">
                  {s.aiAvailable
                    ? `The model proposes clips by beat ID per episode, then judges each one as a first-time viewer. About ${pack.episodes.length + Math.ceil((pack.episodes.length * 4) / 3)} requests.`
                    : `Not available on this server: ${s.status?.reason ?? "server not reachable"}. Configure a provider in .env.local, or open saved AI results.`}
                </span>
              </span>
            </label>
            <label className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${!s.aiChosen ? "border-amber/60 bg-amber-soft/50" : "border-line"}`}>
              <input type="radio" name="mode" className="mt-1 accent-[var(--amber)]" checked={!s.aiChosen} onChange={() => s.setUseAi(false)} />
              <span>
                <span className="text-sm font-semibold text-ink">Heuristic only</span>
                <span className="mt-0.5 block text-[13px] text-muted">Rule-based estimates from timing and structure. Instant and free; every result needs human review.</span>
              </span>
            </label>
          </fieldset>
          {s.aiChosen && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
              <label className="inline-flex items-center gap-2 text-ink-2">
                <input type="checkbox" className="accent-[var(--teal-strong)]" checked={s.stitch} onChange={(e) => s.setStitch(e.target.checked)} disabled={s.running} />
                Also try multi-segment promos (kept only when clearly better)
              </label>
              {s.status?.accessCodeRequired && (
                <label className="inline-flex items-center gap-2 text-ink-2">
                  <Icon name="key" size={14} className="text-muted" />
                  Access code
                  <input
                    type="password"
                    value={s.accessCode}
                    onChange={(e) => s.setAccessCode(e.target.value)}
                    className="h-8 w-40 rounded-lg border border-line-strong bg-surface px-2 text-ink"
                    autoComplete="off"
                  />
                </label>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={s.running ? undefined : "play"} onClick={() => void s.start()} disabled={s.running || needCode}>
              {s.running && <Spinner size={14} />}
              {runLabel}
            </Button>
            {s.running && (
              <Button variant="danger" icon="stop" onClick={s.cancel}>
                Cancel
              </Button>
            )}
            {needCode && <span className="text-xs text-amber">Enter the access code to run AI analysis.</span>}
          </div>
          {(pack.errors.length > 0 || totals.warned.length > 0) && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted">
                Parse notes: {pack.errors.length} file error(s), {totals.warned.length} episode(s) with notes
              </summary>
              <ul className="mt-2 space-y-1 pl-4">
                {pack.errors.map((e, i) => (
                  <li key={`e${i}`} className="text-danger">
                    {e.fileName}: {e.message}
                  </li>
                ))}
                {totals.warned.map((e) => (
                  <li key={e.number} className="text-muted">
                    Episode {e.number}: {e.warnings.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {(s.running || (s.epState.size > 0 && s.run?.meta.mode === "ai" && !s.loaded)) && <RunProgress />}
    </Card>
  );
}

function RunProgress() {
  const s = useStore();
  const p = s.progress;
  return (
    <div className="space-y-3 border-t border-line px-4 py-4" aria-live="polite">
      {p && (
        <div>
          <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-2">{p.message}</span>
            <span className="tc shrink-0 text-muted">
              {p.phase} {p.done}/{p.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-track">
            <div className="h-1.5 rounded-full bg-teal-strong transition-all" style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} />
          </div>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs text-muted">Episodes analysed by the AI proposer</p>
        <ol className="grid grid-cols-10 gap-1 sm:grid-cols-[repeat(25,minmax(0,1fr))]">
          {[...s.epState.entries()].map(([n, st]) => (
            <li
              key={n}
              title={`Episode ${n}: ${st}`}
              className={`tc flex h-6 items-center justify-center rounded text-[10px] ${
                st === "done" ? "bg-ok-soft text-ok" : st === "failed" ? "bg-danger-soft font-bold text-danger" : "skeleton text-subtle"
              }`}
            >
              {n}
            </li>
          ))}
        </ol>
      </div>
      {s.running && s.log.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Activity log</summary>
          <ol className="scroll-thin mt-1 max-h-40 overflow-auto">
            {s.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Notices() {
  const s = useStore();
  return (
    <div className="space-y-3">
      {s.statusError && <Alert tone="warn">{s.statusError}</Alert>}
      {s.parseError && <Alert tone="error">{s.parseError}</Alert>}
      {s.loadError && <Alert tone="error">{s.loadError}</Alert>}
      {s.runError && <Alert tone="error">{s.runError === "Run cancelled" ? "Run cancelled. Results from finished calls are kept for the next run." : s.runError}</Alert>}
      {s.run && s.failedCalls > 0 && (
        <Alert
          tone="warn"
          title={s.accessDenied ? "Access code rejected" : `${s.failedCalls} AI call(s) failed after retries`}
          action={
            <Button size="sm" onClick={() => void s.start()} disabled={s.running}>
              Retry failed calls
            </Button>
          }
        >
          {s.accessDenied ? "AI calls were refused, so rule-based estimates were used. Check the code and run again." : "Affected clips show rule-based estimates and say so. Retrying only re-runs what failed."}
        </Alert>
      )}
      {s.loaded && (
        <Alert tone={s.loaded.failed ? "error" : "ok"} title={`Saved results from ${s.loaded.fileName}`}>
          {s.loaded.failed
            ? `${s.loaded.failed} of ${s.loaded.checked} promos do not match the uploaded screenplays. Check that this is the same pack.`
            : `All ${s.loaded.checked} promos re-checked against the uploaded screenplays: every timestamp is a real beat boundary.`}
        </Alert>
      )}
      {s.run?.meta.mode === "heuristic" && (
        <Alert tone="warn" title="Heuristic Mode — No AI Analysis">
          These picks come from timing and structure rules only. Scores are estimates and every promo needs a human check.
        </Alert>
      )}
    </div>
  );
}

function Dashboard() {
  const s = useStore();
  const run = s.run!;
  const m = s.metrics!;
  const stats = useMemo(() => episodeStats(run, s.pack?.episodes ?? []), [run, s.pack]);
  const head = run.promos.filter((p) => p.headline);
  const rec = run.promos.filter((p) => p.status === "recommended");
  const meanRec = rec.length ? rec.reduce((a, p) => a + p.evaluation.overall, 0) / rec.length : 0;
  const bins = useMemo(() => histogram(run.promos, (p) => p.evaluation.overall, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [run]);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Post first" value={head.length} hint="Diversity-capped shortlist" tone="navy" />
        <Stat label="Recommended" value={m.recommended} hint={`of ${run.promos.length} accepted`} tone="teal" />
        <Stat label="Flagged weak" value={m.weak} hint="Fail a quality check" tone="amber" />
        <Stat label="Episodes covered" value={`${m.episodesWithRecommended}/${m.episodesTotal}`} hint="with a recommended promo" />
        <Stat label="Candidates checked" value={m.candidatesConsidered} hint={`${m.rejected} rejected with reasons`} />
        <Stat label="Mean recommended score" value={meanRec.toFixed(2)} hint={`Cliffhanger pass ${m.cliffhangerPassRate}%`} />
      </div>

      <Card
        title="Episode coverage"
        subtitle="Each cell is an episode. Fill height is its best promo score; colour is that promo's status. Click an episode to see its promos."
        action={<Legend items={[{ kind: "headline" }, { kind: "recommended" }, { kind: "weak" }, { kind: "none" }]} />}
      >
        <div className="px-4 py-4">
          <EpisodeStrip stats={stats} onSelect={s.showEpisode} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
        <Card
          title="Post these first"
          subtitle="Top of the ranked shortlist"
          action={
            <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => s.navigate("promos")}>
              All ranked promos
            </Button>
          }
        >
          <ol className="divide-y divide-line">
            {head.slice(0, 6).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => s.showPromo(p.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="tc w-6 shrink-0 pt-0.5 text-sm font-semibold text-subtle">{p.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-[13px]">
                      <span className="font-semibold text-ink">{epLabel(p)}</span>
                      <span className="tc text-muted">{timeLabel(p)}</span>
                      <span className="tc text-subtle">{secs(p.candidate.durationCs)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{p.evaluation.hook}</span>
                  </span>
                  <span className="tc shrink-0 rounded-md bg-teal-soft px-2 py-1 text-sm font-semibold text-teal">{p.evaluation.overall.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Score distribution" subtitle="Overall score of every accepted promo, stacked by status" action={<Legend items={[{ kind: "headline" }, { kind: "recommended" }, { kind: "weak" }]} />}>
          <div className="px-3 py-4">
            <StackedHistogram bins={bins} formatBin={(lo, hi) => `${lo}–${hi}`} ariaLabel="Histogram of overall scores" />
          </div>
        </Card>
      </div>

      <Card title="Run details">
        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted">Analysis</dt>
            <dd className="mt-0.5 font-medium text-ink">{run.meta.mode === "ai" ? `${run.meta.provider} / ${run.meta.model}` : "Heuristic (no AI)"}</dd>
          </div>
          <div>
            <dt className="text-muted">Source</dt>
            <dd className="mt-0.5 font-medium text-ink">{s.loaded ? `Saved file · ${s.loaded.fileName}` : "Run in this browser"}</dd>
          </div>
          <div>
            <dt className="text-muted">Finished</dt>
            <dd className="tc mt-0.5 font-medium text-ink">{new Date(run.meta.finishedAt ?? run.meta.startedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted">Versions</dt>
            <dd className="tc mt-0.5 font-medium text-ink">
              pipeline {run.meta.pipelineVersion} · prompts {run.meta.promptVersion}
            </dd>
          </div>
        </dl>
        {run.meta.notes.length > 0 && <p className="border-t border-line px-4 py-3 text-xs text-muted">{run.meta.notes.join(" ")}</p>}
      </Card>
    </>
  );
}

export default function Overview() {
  const s = useStore();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Overview</h1>
        <p className="mt-0.5 text-sm text-muted">Find the 20–60 second clips worth posting, with exact cut points from the screenplay.</p>
      </div>
      <Notices />
      {!s.pack ? (
        <>
          <Dropzone />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["upload", "1. Upload the pack", "A ZIP of episode screenplays. It is parsed in your browser into timed beats."],
              ["sparkle", "2. Find promos", "AI proposes clips by beat ID and judges them as a new viewer would; rules work without a key."],
              ["promos", "3. Review and export", "A ranked shortlist with hooks, cliffhangers, exact timecodes and reasons, as JSON or CSV."],
            ].map(([icon, title, body]) => (
              <div key={title} className="card flex gap-3 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
                  <Icon name={icon} size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <SetupPanel compact={Boolean(s.run)} />
          {s.run ? (
            <Dashboard />
          ) : s.running ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card space-y-2 p-4">
                  <div className="skeleton h-3 w-20" />
                  <div className="skeleton h-6 w-12" />
                </div>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon="sparkle" title="Ready to find promos">
                Choose AI analysis or heuristic mode above and run it, or open a saved <code className="font-mono text-[12px]">promos.json</code> from an earlier run.
              </EmptyState>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

