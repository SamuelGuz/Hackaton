export function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i}>
          <div className="h-3 bg-slate-700/35 rounded-md animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-slate-800/90 bg-[linear-gradient(163deg,rgba(17,24,39,0.85)_0%,rgba(8,11,18,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="pointer-events-none absolute inset-0 sc-card-noise opacity-80" aria-hidden />
      <div className="relative z-[1] space-y-3">
        <div className="h-3 w-16 bg-slate-700/35 rounded-md animate-pulse" />
        <div className="h-8 w-24 bg-slate-700/30 rounded-md animate-pulse" />
      </div>
    </div>
  );
}
