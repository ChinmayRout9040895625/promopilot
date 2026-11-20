"use client";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

// ---------------------------------------------------------------- icons (inline, 16px, stroke)

const paths: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  promos: <><path d="M4 6h10M4 12h16M4 18h12" /><circle cx="19" cy="6" r="1.5" /></>,
  candidates: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  reports: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  play: <><path d="M7 5v14l11-7z" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  chevronLeft: <><path d="M15 6l-6 6 6 6" /></>,
  chevronRight: <><path d="M9 6l6 6-6 6" /></>,
  chevronUp: <><path d="M6 15l6-6 6 6" /></>,
  chevronDown: <><path d="M6 9l6 6 6-6" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
};

export function Icon({ name, size = 16, className = "" }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--navy)" />
      <rect x="5" y="14" width="22" height="4" rx="2" fill="var(--surface)" opacity="0.25" />
      <rect x="9" y="14" width="13" height="4" rx="2" fill="var(--surface)" />
      <rect x="9" y="14" width="3.5" height="4" rx="1" fill="#e0a43a" />
      <rect x="21" y="9.5" width="2.6" height="13" rx="1.3" fill="#2dd4bf" />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-navy text-surface hover:opacity-90 dark:text-bg",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "border border-line-strong bg-surface text-danger hover:bg-danger-soft",
};

export function Button({
  variant = "secondary",
  icon,
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "h-8 px-2.5 text-[13px] gap-1.5" : "h-9 px-3.5 text-sm gap-2";
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${variants[variant]} ${className}`}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- badges

type Tone = "navy" | "teal" | "amber" | "danger" | "ok" | "neutral";
const tones: Record<Tone, string> = {
  navy: "bg-navy-soft text-navy",
  teal: "bg-teal-soft text-teal",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  neutral: "bg-surface-3 text-ink-2",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

/** Status pill with a shape cue so status is never colour alone. */
export function StatusBadge({ headline, status }: { headline: boolean; status: string }) {
  if (headline) return <Badge tone="navy">◆ Post first</Badge>;
  if (status === "recommended") return <Badge tone="teal">● Recommended</Badge>;
  return <Badge tone="amber">▲ Weak</Badge>;
}

// ---------------------------------------------------------------- layout primitives

export function Card({ children, className = "", title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "teal" | "navy" | "amber" }) {
  const accent = tone === "teal" ? "bg-c-rec" : tone === "navy" ? "bg-c-post" : tone === "amber" ? "bg-c-weak" : "bg-line-strong";
  return (
    <div className="card relative overflow-hidden px-4 py-3.5">
      <span className={`absolute inset-y-3 left-0 w-[3px] rounded-r ${accent}`} aria-hidden="true" />
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="tc mt-1 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon = "film", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-muted">
        <Icon name={icon} size={20} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error" | "ok"; title?: string; children: ReactNode; action?: ReactNode }) {
  const map = {
    info: { cls: "bg-navy-soft text-ink border-navy/20", icon: "info" },
    warn: { cls: "bg-amber-soft text-ink border-amber/30", icon: "alert" },
    error: { cls: "bg-danger-soft text-ink border-danger/30", icon: "alert" },
    ok: { cls: "bg-ok-soft text-ink border-ok/30", icon: "shield" },
  }[tone];
  const ic = tone === "info" ? "text-navy" : tone === "warn" ? "text-amber" : tone === "error" ? "text-danger" : "text-ok";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-3.5 py-3 text-sm ${map.cls}`}>
      <Icon name={map.icon} size={16} className={`mt-0.5 ${ic}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5 text-ink-2" : ""}>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="scroll-thin inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors ${size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-[13px]"} ${
              on ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className={`tc text-[11px] ${on ? "text-muted" : "text-subtle"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
        className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- theme toggle

type ThemePref = "system" | "light" | "dark";

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("pp-theme");
      if (t === "light" || t === "dark") setPref(t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const apply = (p: ThemePref) => {
    setPref(p);
    const root = document.documentElement;
    if (p === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", p);
    try {
      if (p === "system") localStorage.removeItem("pp-theme");
      else localStorage.setItem("pp-theme", p);
    } catch {
      /* storage unavailable */
    }
  };
  const opts: { v: ThemePref; icon: string; label: string }[] = [
    { v: "light", icon: "sun", label: "Light theme" },
    { v: "system", icon: "monitor", label: "System theme" },
    { v: "dark", icon: "moon", label: "Dark theme" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={pref === o.v}
          aria-label={o.label}
          title={o.label}
          onClick={() => apply(o.v)}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${pref === o.v ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
