"use client";
// Shared UI primitives mapped from the Figma component sets (see docs/frontend-integration.md § Figma map).
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

// ---------- Icon ----------
const PATHS = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  keyboard: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8",
  send: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  question: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17h.01",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  pause: "M8 5v14M16 5v14",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  edit: "M4 20h4l11-11-4-4L4 16zM13 7l4 4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  spinner: "M12 3a9 9 0 1 0 9 9",
  dot: "M12 12h.01",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  calendar: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  chevron: "M9 6l6 6-6 6",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      style={name === "spinner" ? { animation: "mela-spin 0.9s linear infinite" } : undefined}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- Button (Figma 87:125) ----------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "onNight";
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-white shadow-card hover:bg-primary-hover disabled:bg-subtle disabled:text-faint disabled:shadow-none",
  secondary: "bg-surface text-fg ring-1 ring-inset ring-line-strong hover:bg-primary-soft hover:ring-primary/30 disabled:text-faint",
  ghost: "text-muted hover:text-fg hover:bg-primary-soft disabled:text-faint",
  danger: "bg-surface text-warn ring-1 ring-inset ring-warn/40 hover:bg-warn-soft",
  onNight: "bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/20",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; icon?: IconName; iconRight?: IconName; loading?: boolean }>(
  function Button({ variant = "primary", size = "md", icon, iconRight, loading, className = "", children, disabled, ...rest }, ref) {
    const sz = size === "sm" ? "min-h-8 px-3 text-[13px] gap-1.5" : size === "lg" ? "min-h-12 px-5 text-[15px] gap-2" : "min-h-10 px-4 text-[14px] gap-2";
    return (
      <button ref={ref} {...rest} disabled={disabled || loading} aria-busy={loading || undefined}
        className={`inline-flex items-center justify-center rounded-full text-center font-medium leading-tight transition-colors duration-150 disabled:cursor-not-allowed ${sz} ${VARIANT[variant]} ${className}`}>
        {loading ? <Icon name="spinner" /> : icon && <Icon name={icon} />}
        {children}
        {iconRight && !loading && <Icon name={iconRight} />}
      </button>
    );
  },
);

// ---------- Evidence badge (Figma 87:91) ----------
export type BadgeKind =
  | "verified" | "estimated" | "unknown" | "conflicting" | "representative" | "publicPost" | "simulated" | "fixture" | "live"
  | "stale" | "yourWords" | "draft" | "approved" | "held" | "rejected" | "exception" | "verbal" | "excluded" | "rolePlay" | "info";

const BADGE: Record<BadgeKind, { cls: string; icon?: IconName }> = {
  verified: { cls: "bg-ok-soft text-ok", icon: "check" },
  estimated: { cls: "bg-est-soft text-est", icon: "dot" },
  unknown: { cls: "bg-unk-soft text-unk", icon: "question" },
  conflicting: { cls: "bg-held-soft text-held", icon: "alert" },
  representative: { cls: "bg-primary-soft text-primary", icon: "image" },
  publicPost: { cls: "bg-research-soft text-research", icon: "globe" },
  simulated: { cls: "bg-sim-soft text-sim", icon: "file" },
  fixture: { cls: "bg-sim-soft text-sim", icon: "file" },
  live: { cls: "bg-ok-soft text-ok", icon: "dot" },
  stale: { cls: "bg-est-soft text-est", icon: "alert" },
  yourWords: { cls: "bg-primary-soft text-primary", icon: "user" },
  draft: { cls: "bg-subtle text-muted", icon: "file" },
  approved: { cls: "bg-ok-soft text-ok", icon: "check" },
  held: { cls: "bg-held-soft text-held", icon: "pause" },
  rejected: { cls: "bg-warn-soft text-warn", icon: "x" },
  exception: { cls: "bg-warn-soft text-warn", icon: "alert" },
  verbal: { cls: "bg-est-soft text-est", icon: "phone" },
  excluded: { cls: "bg-warn-soft text-warn", icon: "x" },
  rolePlay: { cls: "bg-sim-soft text-sim", icon: "user" },
  info: { cls: "bg-research-soft text-research" },
};

export function Badge({ kind, children, title }: { kind: BadgeKind; children: ReactNode; title?: string }) {
  const b = BADGE[kind];
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium leading-4 ${b.cls}`}>
      {b.icon && <Icon name={b.icon} size={11} className="shrink-0" />}
      {children}
    </span>
  );
}

// ---------- Card ----------
export function Card({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li" }) {
  return <As className={`rounded-2xl bg-surface shadow-card ring-1 ring-line ${className}`}>{children}</As>;
}

// ---------- Dialog: native <dialog> for focus trap + Esc ----------
export function Dialog({ open, onClose, title, children, labelledBy = "dialog-title", wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={`m-auto w-[calc(100vw-32px)] ${wide ? "max-w-[880px]" : "max-w-[540px]"} rounded-3xl border-0 bg-surface p-0 text-fg shadow-float`}>
      {open && (
        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={labelledBy} className="font-serif text-[26px] leading-8">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><Icon name="x" /></Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`label-mono ${className}`}>{children}</p>;
}

// ---------- Page header: eyebrow, one title, one short lede, optional aside ----------
export function PageHeader({ eyebrow, title, lede, aside, id }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[680px]">
        {eyebrow && <SectionLabel className="mb-2">{eyebrow}</SectionLabel>}
        <h1 id={id} tabIndex={-1} className="t-title outline-none">{title}</h1>
        {lede && <p className="t-lede mt-2">{lede}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}

// ---------- Note: a quiet, inline label for demo / simulated / private context ----------
type NoteTone = "neutral" | "sim" | "held" | "ok" | "warn";
const NOTE: Record<NoteTone, string> = {
  neutral: "bg-subtle/70 text-muted",
  sim: "bg-sim-soft text-sim",
  held: "bg-held-soft text-held",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
};
export function Note({ tone = "neutral", icon, children, className = "", role }: { tone?: NoteTone; icon?: IconName; children: ReactNode; className?: string; role?: string }) {
  return (
    <div role={role} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5 ${NOTE[tone]} ${className}`}>
      {icon && <Icon name={icon} size={14} className="mt-[3px] shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------- Disclosure: progressive detail behind a real <details> ----------
export function Disclosure({ summary, meta, children, defaultOpen = false, className = "", open, onToggle }: {
  summary: ReactNode; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; open?: boolean; onToggle?: (open: boolean) => void;
}) {
  return (
    <details className={`group rounded-2xl bg-surface shadow-card ring-1 ring-line ${className}`} open={open ?? defaultOpen}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}>
      <summary className="flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium hover:bg-primary-soft/40 sm:px-5">
        <Icon name="chevron" size={16} className="disclosure-chevron shrink-0 text-faint" />
        <span className="min-w-0 flex-1">{summary}</span>
        {meta && <span className="shrink-0 text-[13px] font-normal text-faint">{meta}</span>}
      </summary>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </details>
  );
}

// ---------- Action bar: the one primary action, with an explanation and quieter alternatives ----------
export function ActionBar({ children, note, sticky = false, className = "" }: { children: ReactNode; note?: ReactNode; sticky?: boolean; className?: string }) {
  return (
    <div className={`${sticky ? "sm:sticky sm:bottom-4 sm:z-20" : ""} flex flex-col gap-3 rounded-2xl bg-surface/95 p-4 shadow-float ring-1 ring-line backdrop-blur sm:flex-row sm:items-center ${className}`}>
      {note && <div className="t-small min-w-0 flex-1">{note}</div>}
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}
