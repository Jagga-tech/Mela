// Mela Orb (Figma component set 88:137). Ten states; the face carries the meaning, motion only reinforces it.
// prefers-reduced-motion: the orb is static (see .orb-motion in globals.css).
export type OrbState = "idle" | "inviting" | "listening" | "thinking" | "speaking" | "succeeded" | "uncertain" | "caution" | "handoff" | "error";

const LABEL: Record<OrbState, string> = {
  idle: "Mela is here", inviting: "Mela is ready to listen", listening: "Mela is listening", thinking: "Mela is thinking",
  speaking: "Mela is speaking", succeeded: "Mela finished", uncertain: "Mela isn't sure", caution: "Mela needs your attention",
  handoff: "Mela is handing off", error: "Something went wrong",
};

const INK = "#2a1b33";

function Eyes({ state }: { state: OrbState }) {
  if (state === "inviting" || state === "succeeded" || state === "handoff")
    return <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none"><path d="M42 61q5-6 10 0" /><path d="M68 61q5-6 10 0" /></g>;
  if (state === "thinking" || state === "caution")
    return <g stroke={INK} strokeWidth="2.6" strokeLinecap="round"><path d="M42 60h10" /><path d="M68 60h10" /></g>;
  if (state === "uncertain")
    return <g><ellipse cx="47" cy="60" rx="3" ry="4.4" fill={INK} /><path d="M68 59h10" stroke={INK} strokeWidth="2.6" strokeLinecap="round" /><path d="M67 50l11-3" stroke={INK} strokeWidth="2.2" strokeLinecap="round" /></g>;
  return (
    <g className={state === "idle" ? "orb-motion" : undefined}>
      <g style={{ transformOrigin: "60px 60px", animation: state === "idle" ? "mela-blink 5s infinite" : undefined }}>
        <ellipse cx="47" cy="60" rx="3" ry="4.4" fill={INK} />
        <ellipse cx="73" cy="60" rx="3" ry="4.4" fill={INK} />
      </g>
    </g>
  );
}

function Mouth({ state }: { state: OrbState }) {
  switch (state) {
    case "speaking":
      return <ellipse cx="60" cy="76" rx="4.5" ry="3.6" fill={INK} className="orb-motion" style={{ animation: "mela-wave 0.5s ease-in-out infinite" }} />;
    case "succeeded":
    case "inviting":
      return <path d="M53 73q7 6 14 0" stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />;
    case "caution":
    case "error":
      return <path d="M55 77h10" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />;
    case "uncertain":
      return <path d="M55 77q5-3 10 1" stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />;
    default:
      return <path d="M57 75q3 2.4 6 0" stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none" />;
  }
}

const RING: Partial<Record<OrbState, { stroke: string; dash?: string }>> = {
  succeeded: { stroke: "#2f5d3a" },
  caution: { stroke: "#9a3f17", dash: "4 4" },
  error: { stroke: "#b23a30" },
  thinking: { stroke: "#7c5fb8", dash: "3 5" },
};

const BADGE: Partial<Record<OrbState, { fg: string; path: string }>> = {
  inviting: { fg: "#4b2e5c", path: "M-5 0c1.5-3 3.5-3 5 0s3.5 3 5 0" },
  listening: { fg: "#4b2e5c", path: "M0-4v5M-3 0a3 3 0 0 0 6 0M0 4v2" },
  thinking: { fg: "#4b2e5c", path: "M-4 0h.1M0 0h.1M4 0h.1" },
  succeeded: { fg: "#2f5d3a", path: "M-4 0l3 3 5-6" },
  uncertain: { fg: "#4b2e5c", path: "M-2-3a2.5 2.5 0 1 1 2 4v1M0 5h.1" },
  caution: { fg: "#9a3f17", path: "M0-4v5M0 5h.1" },
  handoff: { fg: "#4b2e5c", path: "M-4 0h8M1-3l3 3-3 3" },
  error: { fg: "#b23a30", path: "M-3-3l6 6M3-3l-6 6" },
};

export function MelaOrb({ state = "idle", size = 96, onNight = false, decorative = false }: { state?: OrbState; size?: number; onNight?: boolean; decorative?: boolean }) {
  const ring = RING[state];
  const badge = BADGE[state];
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : LABEL[state]}
      aria-hidden={decorative || undefined}
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} className="orb-motion overflow-visible">
        <defs>
          <radialGradient id="orb-body" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#b9a3e6" />
            <stop offset="100%" stopColor="#8466c4" />
          </radialGradient>
        </defs>
        {state === "listening" && (
          <g fill="none" stroke={onNight ? "#cdbcf2" : "#9b7fd1"} strokeWidth="1.5">
            <circle cx="60" cy="60" r="54" style={{ transformOrigin: "60px 60px", animation: "mela-ring 1.8s ease-out infinite" }} />
            <circle cx="60" cy="60" r="54" style={{ transformOrigin: "60px 60px", animation: "mela-ring 1.8s ease-out 0.9s infinite" }} />
          </g>
        )}
        <circle cx="60" cy="60" r="55" fill={onNight ? "rgba(255,255,255,0.14)" : "#efe6f2"} />
        {ring && (
          <circle cx="60" cy="60" r="55" fill="none" stroke={ring.stroke} strokeWidth="2" strokeDasharray={ring.dash}
            style={state === "thinking" ? { transformOrigin: "60px 60px", animation: "mela-spin 6s linear infinite" } : undefined} />
        )}
        <g style={{ transformOrigin: "60px 60px", animation: state === "idle" || state === "inviting" ? "mela-breathe 4.5s ease-in-out infinite" : undefined }}>
          <circle cx="60" cy="60" r="45" fill="url(#orb-body)" />
          <ellipse cx="44" cy="36" rx="15" ry="9" fill="#fff" opacity="0.32" />
          <ellipse cx="40" cy="71" rx="6" ry="3.4" fill="#f4a49c" opacity="0.75" />
          <ellipse cx="80" cy="71" rx="6" ry="3.4" fill="#f4a49c" opacity="0.75" />
          <Eyes state={state} />
          <Mouth state={state} />
        </g>
        {state === "speaking" && (
          <g fill="none" stroke={onNight ? "#e6dcff" : "#7c5fb8"} strokeWidth="2.4" strokeLinecap="round">
            <path d="M110 48q6 12 0 24" style={{ animation: "mela-wave 0.9s ease-in-out infinite" }} />
            <path d="M117 42q9 18 0 36" style={{ animation: "mela-wave 0.9s ease-in-out 0.3s infinite" }} />
          </g>
        )}
        {badge && (
          <g transform="translate(98 98)">
            <circle r="13" fill="#fffcf7" stroke={badge.fg} strokeWidth="1.5" />
            <path d={badge.path} fill="none" stroke={badge.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
    </span>
  );
}
