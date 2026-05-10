type Variant = "risk" | "expansion";

function tone(score: number, variant: Variant): { fill: string; text: string } {
  if (variant === "risk") {
    if (score >= 70) return { fill: "bg-rose-500",   text: "text-rose-300" };
    if (score >= 40) return { fill: "bg-amber-500",  text: "text-amber-300" };
    return                   { fill: "bg-slate-500", text: "text-slate-400" };
  }
  if (score >= 70) return { fill: "bg-sky-500",    text: "text-sky-300" };
  if (score >= 40) return { fill: "bg-indigo-500", text: "text-indigo-300" };
  return                   { fill: "bg-slate-500", text: "text-slate-400" };
}

export function ScoreBar({ score, variant }: { score: number; variant: Variant }) {
  const { fill, text } = tone(score, variant);
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-12 h-1.5 bg-slate-700/70 rounded-full overflow-hidden">
        <div className={`h-full ${fill} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className={`tabular-nums text-xs font-semibold w-6 text-right ${text}`}>{score}</span>
    </div>
  );
}
