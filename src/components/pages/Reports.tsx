"use client";
import { useMemo, type ReactNode } from "react";
import { useStore } from "@/components/app/store";
import { Badge, Button, Card, EmptyState, Icon, download, fileStamp } from "@/components/app/ui";
import { qualityReport, toCsv, toJson } from "@/core/export";

/** Minimal markdown renderer for the generated quality report (headings, lists, tables, bold, code). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i} className="rounded bg-surface-3 px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>;
    return part.replace(/\\\|/g, "|");
  });
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) block.push(lines[i++]);
      i--;
      const cells = (r: string) => r.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
      const [head, , ...body] = block;
      out.push(
        <div key={i} className="scroll-thin my-3 overflow-x-auto">
          <table className="tc w-full text-left text-[12.5px]">
            <thead className="text-muted">
              <tr>{cells(head).map((c, j) => <th key={j} className="border-b border-line px-2 py-1.5 font-medium">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k} className="border-b border-line last:border-0">
                  {cells(r).map((c, j) => <td key={j} className="px-2 py-1.5 align-top text-ink-2">{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (l.startsWith("# ")) out.push(<h2 key={i} className="mt-2 text-lg font-semibold text-ink">{inline(l.slice(2))}</h2>);
    else if (l.startsWith("## ")) out.push(<h3 key={i} className="mt-6 text-[15px] font-semibold text-ink">{inline(l.slice(3))}</h3>);
    else if (l.startsWith("- ")) out.push(<p key={i} className="ml-4 list-item list-disc text-[13px] text-ink-2">{inline(l.slice(2))}</p>);
    else if (l.trim()) out.push(<p key={i} className="my-2 text-[13px] text-ink-2">{inline(l)}</p>);
  }
  return <div>{out}</div>;
}

export default function Reports() {
  const s = useStore();
  const run = s.run;
  const report = useMemo(() => (run ? qualityReport(run, run.meta.mode === "ai" ? s.baseline ?? undefined : undefined) : ""), [run, s.baseline]);
  const json = useMemo(() => (run ? toJson(run) : ""), [run]);
  const csv = useMemo(() => (run ? toCsv(run) : ""), [run]);
  const rawJson = useMemo(() => (run && run.rawLlm.length ? toJson(run, { includeRaw: true }) : ""), [run]);
  const kb = (t: string) => `${Math.max(1, Math.round(new Blob([t]).size / 1024))} KB`;

  if (!run) {
    return (
      <Card>
        <EmptyState icon="reports" title="No results to export" action={<Button variant="primary" onClick={() => s.navigate("overview")}>Go to Overview</Button>}>
          Run an analysis or open saved results to download JSON, CSV and the quality report.
        </EmptyState>
      </Card>
    );
  }

  const exports = [
    { title: "Promos (JSON)", body: "Every ranked promo with segments, scores, explanations, warnings, rank reasons and run metadata.", size: kb(json), icon: "reports", act: () => download(`promopilot-${fileStamp()}.json`, json, "application/json") },
    { title: "Promos (CSV)", body: "One row per segment, ready for an editor's sheet: rank, reason, episode, start, end, scores, hook, cliffhanger.", size: kb(csv), icon: "table", act: () => download(`promopilot-${fileStamp()}.csv`, csv, "text/csv") },
    { title: "Quality report (Markdown)", body: "Funnel metrics, pass rates, coverage, why the top picks rank where they do, and a review sheet.", size: kb(report), icon: "analytics", act: () => download(`promopilot-quality-${fileStamp()}.md`, report, "text/markdown") },
    ...(rawJson
      ? [{ title: "Promos with raw AI output", body: "Same as the JSON export, plus every raw model response from this browser run.", size: kb(rawJson), icon: "sparkle", act: () => download(`promopilot-raw-${fileStamp()}.json`, rawJson, "application/json") }]
      : []),
  ];

  const st = s.status;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Reports & exports</h1>
        <p className="mt-0.5 text-sm text-muted">Download the results exactly as produced. Exports are generated in your browser from the loaded run.</p>
      </div>

      <div className={`grid gap-3 md:grid-cols-2 ${exports.length > 3 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        {exports.map((e) => (
          <div key={e.title} className="card flex flex-col p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-soft text-navy">
                <Icon name={e.icon} size={16} />
              </div>
              <p className="text-sm font-semibold text-ink">{e.title}</p>
            </div>
            <p className="mt-2 flex-1 text-[13px] text-muted">{e.body}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="tc text-xs text-subtle">{e.size}</span>
              <Button size="sm" icon="download" onClick={e.act}>
                Download
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <Card title="Quality report preview" subtitle="Generated from the loaded run">
          <div className="scroll-thin max-h-[640px] overflow-y-auto px-5 py-3">
            <Markdown text={report} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="This run">
            <dl className="divide-y divide-line text-[13px]">
              {[
                ["Mode", run.meta.mode === "ai" ? <Badge tone="teal">AI analysis</Badge> : <Badge tone="amber">Heuristic — no AI</Badge>],
                ["Provider / model", run.meta.mode === "ai" ? `${run.meta.provider} / ${run.meta.model}` : "none"],
                ["Source", s.loaded ? `Saved file: ${s.loaded.fileName}` : "Run in this browser"],
                ["Timestamps checked", s.loaded ? `${s.loaded.checked - s.loaded.failed} of ${s.loaded.checked} valid` : "Validated during the run"],
                ["Episodes parsed", run.meta.episodesParsed],
                ["AI failures", run.meta.episodesFailed.length ? `Episodes ${run.meta.episodesFailed.join(", ")}` : "None"],
                ["Started", new Date(run.meta.startedAt).toLocaleString()],
                ["Pipeline / prompts", `${run.meta.pipelineVersion} / ${run.meta.promptVersion}`],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-start justify-between gap-3 px-4 py-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="tc text-right font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Provider configuration" subtitle="Read from server environment variables. Keys never reach the browser.">
            <dl className="divide-y divide-line text-[13px]">
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-muted">AI on this server</dt>
                <dd className="font-medium">{st ? (st.aiEnabled ? <Badge tone="ok">Enabled</Badge> : <Badge>Off</Badge>) : "Checking…"}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-muted">Provider</dt>
                <dd className="font-medium text-ink">{st?.provider ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-muted">Model</dt>
                <dd className="font-medium text-ink">{st?.model ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-muted">Access code</dt>
                <dd className="font-medium text-ink">{st?.accessCodeRequired ? "Required" : "Not required"}</dd>
              </div>
              {st && !st.aiEnabled && st.reason && <p className="px-4 py-2 text-xs text-muted">Why off: {st.reason}</p>}
              <p className="px-4 py-2.5 text-xs text-muted">
                Change it with <code className="font-mono">AI_PROVIDER</code> (anthropic, gemini, openai-compatible or none), <code className="font-mono">AI_MODEL</code> and the provider key in{" "}
                <code className="font-mono">.env.local</code> or your Vercel project settings.
              </p>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
