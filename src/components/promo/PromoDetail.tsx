"use client";
import { useState } from "react";
import type { Episode, Promo } from "@/core/types";
import { WEIGHTS } from "@/core/score";
import { formatTimecode } from "@/core/timecode";
import { Badge, Button, Icon, StatusBadge } from "@/components/app/ui";
import { epLabel, secs } from "@/lib/derive";

const pct = (cs: number, total: number) => `${Math.max(0, Math.min(100, (cs / total) * 100))}%`;

/** Where the clip sits in its episode: clip in navy, first 3 s in amber, the cut in teal. */
export function CutTimeline({ promo, episodes, compact = false }: { promo: Promo; episodes: Map<number, Episode>; compact?: boolean }) {
  return (
    <div className="space-y-3">
      {promo.candidate.segments.map((s, i) => {
        const ep = episodes.get(s.episode);
        const total = ep?.durationCs ?? s.endCs;
        const hookEnd = Math.min(s.endCs, s.startCs + 300);
        return (
          <div key={i}>
            {!compact && (
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                <span>
                  {promo.candidate.segments.length > 1 && <span className="font-semibold text-ink">Part {i + 1} · </span>}
                  Episode {s.episode}
                </span>
                <span className="tc">
                  <span className="font-semibold text-ink">{s.startTc}</span> → <span className="font-semibold text-ink">{s.endTc}</span>
                  <span className="ml-2 text-subtle">of {formatTimecode(total)}</span>
                </span>
              </div>
            )}
            <div
              className={`relative rounded-full bg-track ${compact ? "h-1.5" : "h-2.5"}`}
              role="img"
              aria-label={`Clip from ${s.startTc} to ${s.endTc} in episode ${s.episode}, which runs ${formatTimecode(total)}. First 3 seconds marked as the hook; the end marks the cut.`}
            >
              <div className="absolute inset-y-0 rounded-full bg-navy" style={{ left: pct(s.startCs, total), width: pct(s.endCs - s.startCs, total) }} />
              <div className="absolute inset-y-0 rounded-l-full bg-[#e0a43a]" style={{ left: pct(s.startCs, total), width: pct(hookEnd - s.startCs, total) }} />
              {!compact && <div className="absolute -inset-y-1 w-[3px] rounded bg-teal-strong" style={{ left: `calc(${pct(s.endCs, total)} - 1.5px)` }} />}
            </div>
          </div>
        );
      })}
      {!compact && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-navy" />Clip</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[#e0a43a]" />First 3 s (hook)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] rounded bg-teal-strong" />Cut (cliffhanger)</span>
        </div>
      )}
    </div>
  );
}

const LABELS: [keyof typeof WEIGHTS, string][] = [
  ["hook", "Hook"],
  ["cliffhanger", "Cliffhanger"],
  ["standalone", "Standalone clarity"],
  ["intensity", "Emotional intensity"],
  ["appeal", "Promo appeal"],
];

export function ScoreBars({ promo }: { promo: Promo }) {
  const s = promo.evaluation.scores;
  return (
    <dl className="space-y-2.5">
      {LABELS.map(([k, label]) => (
        <div key={k}>
          <div className="mb-1 flex items-baseline justify-between text-[13px]">
            <dt className="text-ink-2">
              {label} <span className="text-[11px] text-subtle">{Math.round(WEIGHTS[k] * 100)}%</span>
            </dt>
            <dd className="tc font-semibold text-ink">
              {s[k]}
              <span className="font-normal text-subtle">/10</span>
            </dd>
          </div>
          <dd className="h-1.5 rounded-full bg-track" aria-hidden="true">
            <div className={`h-1.5 rounded-full ${s[k] < 5 ? "bg-c-weak" : "bg-teal-strong"}`} style={{ width: `${s[k] * 10}%` }} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Verdict({ label, value, good }: { label: string; value: boolean | null; good: boolean }) {
  const ok = value === null ? null : value === good;
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className="text-ink-2">{label}</span>
      {value === null ? (
        <span className="text-subtle">not assessed</span>
      ) : (
        <span className={`inline-flex items-center gap-1 font-medium ${ok ? "text-ok" : "text-amber"}`}>
          <Icon name={ok ? "check" : "alert"} size={13} />
          {value ? "Yes" : "No"}
        </span>
      )}
    </li>
  );
}

const sourceLabel = { ai: "AI-proposed", heuristic: "Rule-based pick", stitch: "Multi-segment (AI)" } as const;

function ScoreDial({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0" role="img" aria-label={`Overall score ${value.toFixed(2)} out of 10`}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--teal-strong)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(value / 10) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tc text-[17px] font-semibold leading-none text-ink">{value.toFixed(2)}</span>
        <span className="mt-0.5 text-[10px] text-subtle">of 10</span>
      </div>
    </div>
  );
}

export function PromoDetail({
  promo,
  episodes,
  onPrev,
  onNext,
  position,
}: {
  promo: Promo;
  episodes: Map<number, Episode>;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}) {
  const [copied, setCopied] = useState(false);
  const e = promo.evaluation;
  const copy = async () => {
    const text = promo.candidate.segments.map((s) => `E${s.episode} ${s.startTc}-${s.endTc}`).join(" + ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <article aria-label={`Promo rank ${promo.rank}`} className="flex h-full flex-col">
      <header className="border-b border-line px-5 py-4">
        <div className="flex items-start gap-4">
          <ScoreDial value={e.overall} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge headline={promo.headline} status={promo.status} />
              <Badge>{sourceLabel[promo.candidate.source]}</Badge>
              {e.scoreSource === "heuristic" && <Badge tone="amber">Rule-based estimate</Badge>}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold leading-tight text-ink">
              <span className="tc">#{promo.rank}</span> · {epLabel(promo)} · <span className="tc">{secs(promo.candidate.durationCs)}</span>
            </h2>
            <p className="tc mt-0.5 text-xs text-muted">{promo.id} · candidate {promo.candidate.id}</p>
          </div>
          {(onPrev || onNext) && (
            <div className="hidden shrink-0 items-center gap-1 sm:flex">
              {position && <span className="tc mr-1 text-xs text-subtle">{position}</span>}
              <Button size="sm" variant="ghost" icon="chevronUp" onClick={onPrev} disabled={!onPrev} aria-label="Previous promo" />
              <Button size="sm" variant="ghost" icon="chevronDown" onClick={onNext} disabled={!onNext} aria-label="Next promo" />
            </div>
          )}
        </div>
        {promo.rankReason && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-[13px] leading-relaxed ${promo.status === "weak" ? "bg-amber-soft text-ink" : "bg-navy-soft text-ink"}`}>
            <span className="font-semibold">Why this rank. </span>
            {promo.rankReason}
          </p>
        )}
      </header>

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted">Cut points</h3>
            <Button size="sm" variant="ghost" icon={copied ? "check" : "copy"} onClick={copy}>
              {copied ? "Copied" : "Copy timecodes"}
            </Button>
          </div>
          <CutTimeline promo={promo} episodes={episodes} />
          <table className="tc mt-4 w-full text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 font-medium">Segment</th>
                <th className="py-1.5 font-medium">Episode</th>
                <th className="py-1.5 font-medium">Start</th>
                <th className="py-1.5 font-medium">End</th>
                <th className="py-1.5 text-right font-medium">Length</th>
              </tr>
            </thead>
            <tbody>
              {promo.candidate.segments.map((s, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1.5">{i + 1}</td>
                  <td className="py-1.5">{s.episode}</td>
                  <td className="py-1.5 font-semibold">{s.startTc}</td>
                  <td className="py-1.5 font-semibold">{s.endTc}</td>
                  <td className="py-1.5 text-right">{((s.endCs - s.startCs) / 100).toFixed(2)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-3 text-[14px] leading-relaxed">
          <div className="rounded-lg border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-amber">Hook · first 3 seconds</p>
            <p className="text-ink">{e.hook}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-teal">Cliffhanger · the cut</p>
            <p className="text-ink">{e.cliffhanger}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-navy">Why it works</p>
            <p className="text-ink">{e.whyItWorks}</p>
            {promo.candidate.pitch && (
              <p className="mt-2 border-t border-line pt-2 text-[13px] text-muted">
                <span className="font-medium text-ink-2">Proposer note: </span>
                {promo.candidate.pitch}
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-xs font-semibold text-muted">Score breakdown</h3>
            <ScoreBars promo={promo} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">Judge verdicts</h3>
            <ul className="divide-y divide-line text-[13px]">
              <Verdict label="Opening grabs attention" value={e.openingInteresting} good />
              <Verdict label="Ending creates curiosity" value={e.endingCreatesCuriosity} good />
              <Verdict label="Ending resolved" value={e.endingResolved} good={false} />
              <Verdict label="Makes sense alone" value={e.makesSenseAlone} good />
              <li className="flex items-center justify-between gap-2 py-1">
                <span className="text-ink-2">Judge confidence</span>
                <span className="font-medium capitalize">{e.scoreSource === "ai" ? e.confidence : "rules only"}</span>
              </li>
            </ul>
          </div>
        </section>

        {promo.warnings.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold text-muted">Warnings for the editor</h3>
            <ul className="space-y-1.5">
              {promo.warnings.map((w, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                  <Icon name="alert" size={14} className="mt-0.5 text-amber" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
