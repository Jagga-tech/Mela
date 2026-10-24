export const newId = (prefix: string) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 10)}`;

/** FNV-1a over canonical JSON. Binds an approval to exact script content; the server should use sha256. */
export function stableHash(value: unknown): string {
  const s = canonical(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v);
}

export const usd = (cents: number | null | undefined, opts: { exact?: boolean } = {}) => {
  if (cents === null || cents === undefined) return "Unknown";
  const exact = opts.exact ?? cents % 100 !== 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 });
};

export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "Not set";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

export const formatTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
