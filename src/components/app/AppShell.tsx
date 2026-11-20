"use client";
import { useEffect, useState } from "react";
import { useStore, WorkspaceProvider, type View } from "./store";
import { Badge, Icon, Logo, Spinner, ThemeToggle } from "./ui";
import Overview from "@/components/pages/Overview";
import RankedPromos from "@/components/pages/RankedPromos";
import Candidates from "@/components/pages/Candidates";
import Analytics from "@/components/pages/Analytics";
import Reports from "@/components/pages/Reports";

const NAV: { view: View; label: string; icon: string }[] = [
  { view: "overview", label: "Overview", icon: "overview" },
  { view: "promos", label: "Ranked Promos", icon: "promos" },
  { view: "candidates", label: "All Candidates", icon: "candidates" },
  { view: "analytics", label: "Analytics", icon: "analytics" },
  { view: "reports", label: "Reports & Exports", icon: "reports" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const s = useStore();
  const count = (v: View) => {
    if (!s.run) return null;
    if (v === "promos") return s.run.promos.filter((p) => p.headline).length;
    if (v === "candidates") return s.metrics?.candidatesConsidered ?? null;
    return null;
  };
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {NAV.map((n) => {
          const on = s.view === n.view;
          const c = count(n.view);
          return (
            <li key={n.view}>
              <a
                href={`#/${n.view}`}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
                  on ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:bg-surface-3/60 hover:text-ink"
                }`}
              >
                <Icon name={n.icon} size={16} className={on ? "text-teal" : "text-muted"} />
                <span className="flex-1">{n.label}</span>
                {c !== null && <span className="tc text-[11px] text-subtle">{c}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarFooter() {
  const s = useStore();
  const st = s.status;
  return (
    <div className="space-y-3 text-xs">
      {s.pack && (
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <p className="font-medium text-ink-2">Dataset</p>
          <p className="mt-0.5 truncate text-muted" title={s.fileName ?? ""}>
            {s.fileName}
          </p>
          <p className="tc mt-0.5 text-subtle">{s.pack.episodes.length} episodes</p>
        </div>
      )}
      <div className="flex items-center gap-2 px-1 text-muted">
        <span className={`h-2 w-2 rounded-full ${st?.aiEnabled ? "bg-ok" : st ? "bg-subtle" : "bg-amber"}`} aria-hidden="true" />
        <span className="truncate">{st ? (st.aiEnabled ? `AI ready · ${st.model}` : "AI off on this server") : s.statusError ? "Server unreachable" : "Checking server…"}</span>
      </div>
    </div>
  );
}

function ModeBadge() {
  const s = useStore();
  if (s.running) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-teal-soft px-2.5 py-1 text-xs font-medium text-teal">
        <Spinner size={12} /> {s.progress ? `${s.progress.phase} ${s.progress.done}/${s.progress.total}` : "Starting…"}
      </span>
    );
  }
  if (s.run) {
    return s.run.meta.mode === "ai" ? (
      <Badge tone="teal" className="px-2.5 py-1 text-xs">
        <Icon name="sparkle" size={12} /> AI analysis<span className="hidden sm:inline"> · {s.run.meta.model}</span>
      </Badge>
    ) : (
      <Badge tone="amber" className="px-2.5 py-1 text-xs">
        <span className="sm:hidden">Heuristic — no AI</span>
        <span className="hidden sm:inline">Heuristic Mode — No AI Analysis</span>
      </Badge>
    );
  }
  return null;
}

function Shell() {
  const s = useStore();
  const [drawer, setDrawer] = useState(false);
  const title = NAV.find((n) => n.view === s.view)?.label ?? "";
  useEffect(() => {
    document.title = `${title} · PromoPilot AI`;
  }, [title]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const Page = { overview: Overview, promos: RankedPromos, candidates: Candidates, analytics: Analytics, reports: Reports }[s.view];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <div className="hidden border-r border-line bg-surface-2 lg:block">
      <aside className="sticky top-0 flex h-screen flex-col justify-between px-3 py-4">
        <div>
          <a href="#/overview" className="mb-6 flex items-center gap-2.5 px-2">
            <Logo />
            <span>
              <span className="block text-[15px] font-semibold leading-tight tracking-tight text-ink">PromoPilot AI</span>
              <span className="block text-[11px] text-muted">Promo intelligence</span>
            </span>
          </a>
          <NavList />
        </div>
        <SidebarFooter />
      </aside>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[260px] flex-col justify-between bg-surface-2 px-3 py-4 shadow-[var(--shadow-lg)]">
            <div>
              <div className="mb-6 flex items-center justify-between px-2">
                <span className="flex items-center gap-2.5">
                  <Logo />
                  <span className="text-[15px] font-semibold text-ink">PromoPilot AI</span>
                </span>
                <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="rounded-md p-1 text-muted hover:text-ink">
                  <Icon name="close" />
                </button>
              </div>
              <NavList onNavigate={() => setDrawer(false)} />
            </div>
            <SidebarFooter />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" size={18} />
          </button>
          <span className="flex items-center gap-2 lg:hidden">
            <Logo size={22} />
          </span>
          <p className="min-w-0 truncate text-sm font-medium text-ink-2">{title}</p>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <ModeBadge />
            <ThemeToggle />
          </div>
        </header>
        {s.running && s.progress && (
          <div className="h-0.5 bg-track" aria-hidden="true">
            <div className="h-0.5 bg-teal-strong transition-all" style={{ width: `${(s.progress.done / Math.max(1, s.progress.total)) * 100}%` }} />
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Page />
        </main>
      </div>
    </div>
  );
}

export default function AppShell() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
