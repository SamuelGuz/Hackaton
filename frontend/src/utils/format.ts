export function humanize(snakeCase: string): string {
  return snakeCase
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatArr(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (usd >= 10_000) return `$${Math.round(usd / 1000)}k`;
  if (usd >= 1_000) return `$${(usd / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${usd}`;
}

export function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function formatRenewal(iso: string): { label: string; tone: "urgent" | "soon" | "normal" } {
  const days = daysUntil(iso);
  if (days < 0) return { label: `Vencido hace ${Math.abs(days)}d`, tone: "urgent" };
  if (days <= 30) return { label: `En ${days} días`, tone: "urgent" };
  if (days <= 90) return { label: `En ${days} días`, tone: "soon" };
  if (days <= 365) {
    const months = Math.round(days / 30);
    return { label: `En ${months} ${months === 1 ? "mes" : "meses"}`, tone: "normal" };
  }
  return { label: new Date(iso).toLocaleDateString("es", { month: "short", year: "numeric" }), tone: "normal" };
}

const AVATAR_PALETTE = [
  "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  "bg-sky-500/20 text-sky-300 ring-sky-500/40",
  "bg-violet-500/20 text-violet-300 ring-violet-500/40",
  "bg-fuchsia-500/20 text-fuchsia-300 ring-fuchsia-500/40",
  "bg-teal-500/20 text-teal-300 ring-teal-500/40",
  "bg-orange-500/20 text-orange-300 ring-orange-500/40",
];

export function avatarStyle(name: string): { initials: string; className: string } {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  return { initials, className: AVATAR_PALETTE[idx] };
}
