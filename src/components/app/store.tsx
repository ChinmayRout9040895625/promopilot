"use client";
/**
 * Workspace state shared by every dashboard page. All analysis logic stays in src/core and the
 * API routes; this file only holds UI state and calls the same functions the old single page did.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readZipTextFiles } from "@/core/zip";
import { parsePack } from "@/core/parse";
import { runPipeline, type ProgressEvent } from "@/core/pipeline";
import { computeMetrics, type Metrics } from "@/core/export";
import { importRunJson, verifyRunAgainst } from "@/core/importRun";
import type { Episode, ParsedPack, RunResult } from "@/core/types";
import { clearWebCache, webExecutors } from "@/lib/webExecutors";

export interface Status {
  aiEnabled: boolean;
  provider: string;
  model: string | null;
  reason: string | null;
  accessCodeRequired: boolean;
  pipelineVersion: string;
  promptVersion: string;
}

export type EpState = "waiting" | "done" | "failed";
export type View = "overview" | "promos" | "candidates" | "analytics" | "reports";
export const VIEWS: View[] = ["overview", "promos", "candidates", "analytics", "reports"];

export interface PromoFilter {
  status: "headline" | "recommended" | "weak" | "all";
  source: "all" | "ai" | "heuristic" | "stitch";
  arc: number | 0;
  episode: number | 0;
  minScore: number;
  sort: "rank" | "overall" | "hook" | "cliffhanger" | "standalone" | "duration" | "episode";
  query: string;
}

export const DEFAULT_FILTER: PromoFilter = { status: "headline", source: "all", arc: 0, episode: 0, minScore: 0, sort: "rank", query: "" };

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

interface Store {
  status: Status | null;
  statusError: string | null;
  fileName: string | null;
  pack: ParsedPack | null;
  episodes: Map<number, Episode>;
  parsing: boolean;
  parseError: string | null;
  aiAvailable: boolean;
  aiChosen: boolean;
  setUseAi: (v: boolean) => void;
  stitch: boolean;
  setStitch: (v: boolean) => void;
  accessCode: string;
  setAccessCode: (v: string) => void;
  running: boolean;
  progress: ProgressEvent | null;
  epState: Map<number, EpState>;
  log: string[];
  run: RunResult | null;
  baseline: RunResult | null;
  metrics: Metrics | null;
  loaded: { fileName: string; checked: number; failed: number } | null;
  loadError: string | null;
  runError: string | null;
  failedCalls: number;
  accessDenied: boolean;
  loadFile: (f: File) => Promise<void>;
  openSaved: (f: File) => Promise<void>;
  start: () => Promise<void>;
  cancel: () => void;
  view: View;
  selectedId: string | null;
  navigate: (view: View, selectedId?: string | null) => void;
  filter: PromoFilter;
  setFilter: (f: Partial<PromoFilter>) => void;
  showPromo: (promoId: string) => void;
  showEpisode: (episode: number) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside WorkspaceProvider");
  return s;
}

function parseHash(h: string): { view: View; id: string | null } {
  const [v, id] = h.replace(/^#\/?/, "").split("/");
  const view = (VIEWS as string[]).includes(v) ? (v as View) : "overview";
  return { view, id: id ? decodeURIComponent(id) : null };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pack, setPack] = useState<ParsedPack | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [stitch, setStitch] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [epState, setEpState] = useState<Map<number, EpState>>(new Map());
  const [log, setLog] = useState<string[]>([]);
  const [run, setRun] = useState<RunResult | null>(null);
  const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Store["loaded"]>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilterState] = useState<PromoFilter>(DEFAULT_FILTER);
  const abortRef = useRef<AbortController | null>(null);

  // Hash routing: #/promos/P003 etc. Keeps back/forward and deep links working.
  useEffect(() => {
    const apply = () => {
      const { view: v, id } = parseHash(window.location.hash);
      setView(v);
      if (v === "promos") setSelectedId(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const navigate = useCallback((v: View, id?: string | null) => {
    const hash = `#/${v}${id ? `/${encodeURIComponent(id)}` : ""}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    else {
      setView(v);
      if (v === "promos") setSelectedId(id ?? null);
    }
  }, []);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        if (!s.aiEnabled) setUseAi(false);
      })
      .catch(() => {
        setStatusError("Could not reach the server. Heuristic mode and saved results still work in this browser.");
        setUseAi(false);
      });
  }, []);

  const episodes = useMemo(() => new Map((pack?.episodes ?? []).map((e) => [e.number, e])), [pack]);
  const aiAvailable = Boolean(status?.aiEnabled);
  const aiChosen = aiAvailable && useAi;
  const metrics = useMemo(() => (run ? computeMetrics(run) : null), [run]);
  const failedCalls = run?.rawLlm.filter((r) => !r.ok).length ?? 0;
  const accessDenied = run?.rawLlm.some((r) => /access_denied/.test(r.error ?? "")) ?? false;

  const loadFile = useCallback(async (file: File) => {
    setParseError(null);
    setRun(null);
    setBaseline(null);
    setRunError(null);
    setPack(null);
    setLoaded(null);
    setLoadError(null);
    setEpState(new Map());
    setProgress(null);
    clearWebCache();
    if (!/\.zip$/i.test(file.name)) {
      setParseError("That file is not a ZIP. Upload the screenplay pack as a .zip file.");
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setParseError("The ZIP is larger than 50 MB. Split the pack and upload it in parts.");
      return;
    }
    setFileName(file.name);
    setParsing(true);
    try {
      const { files, skipped } = await readZipTextFiles(await file.arrayBuffer());
      if (!files.length) {
        setParseError("No .txt screenplay files were found in this ZIP.");
        return;
      }
      setPack(parsePack(files, skipped));
    } catch {
      setParseError("The ZIP could not be read. Check that the file is not corrupted and try again.");
    } finally {
      setParsing(false);
    }
  }, []);

  const openSaved = useCallback(
    async (file: File) => {
      if (!pack) {
        setLoadError("Upload the screenplay ZIP first, so the saved timestamps can be checked against it.");
        return;
      }
      setLoadError(null);
      try {
        const result = importRunJson(await file.text());
        const v = verifyRunAgainst(result, pack.episodes);
        setRun(result);
        setBaseline(null);
        setEpState(new Map());
        setProgress(null);
        setRunError(null);
        setFilterState(DEFAULT_FILTER);
        setLoaded({ fileName: file.name, checked: v.checked, failed: v.failed.length });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "The results file could not be opened.");
      }
    },
    [pack],
  );

  const start = useCallback(async () => {
    if (!pack?.episodes.length) return;
    setLoaded(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setRun(null);
    setRunError(null);
    setLog([]);
    setProgress(null);
    setFilterState(DEFAULT_FILTER);
    setEpState(new Map(pack.episodes.map((e) => [e.number, "waiting" as EpState])));
    const onProgress = (e: ProgressEvent) => {
      setProgress(e);
      if (e.phase === "propose" && e.episode !== undefined) setEpState((m) => new Map(m).set(e.episode!, e.failed ? "failed" : "done"));
      if (e.phase !== "heuristic") setLog((l) => [...l.slice(-199), e.message]);
    };
    try {
      const base = await runPipeline(pack.episodes, {}, { provider: "none", model: "none" });
      setBaseline(base);
      if (!aiChosen) {
        setEpState(new Map(pack.episodes.map((e) => [e.number, "done" as EpState])));
        setRun(base);
      } else {
        const exec = webExecutors({ accessCode, stitch, signal: ac.signal });
        const result = await runPipeline(pack.episodes, exec, {
          provider: status!.provider,
          model: status!.model ?? "",
          concurrency: 3,
          judgeBatchSize: 3,
          stitch,
          onProgress,
          signal: ac.signal,
        });
        setRun(result);
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "The run stopped unexpectedly.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [pack, aiChosen, accessCode, stitch, status]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const setFilter = useCallback((f: Partial<PromoFilter>) => setFilterState((old) => ({ ...old, ...f })), []);
  const showPromo = useCallback((id: string) => navigate("promos", id), [navigate]);
  const showEpisode = useCallback(
    (episode: number) => {
      setFilterState({ ...DEFAULT_FILTER, status: "all", episode });
      navigate("promos");
    },
    [navigate],
  );

  const value: Store = {
    status, statusError, fileName, pack, episodes, parsing, parseError, aiAvailable, aiChosen, setUseAi, stitch, setStitch,
    accessCode, setAccessCode, running, progress, epState, log, run, baseline, metrics, loaded, loadError, runError,
    failedCalls, accessDenied, loadFile, openSaved, start, cancel, view, selectedId, navigate, filter, setFilter, showPromo, showEpisode,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
