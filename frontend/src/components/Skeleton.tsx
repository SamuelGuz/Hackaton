export function SkeletonRow() {
  return (
    <tr className="border-b border-slate-800/60">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-3 bg-slate-700/40 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
      <div className="h-3 w-16 bg-slate-700/40 rounded animate-pulse mb-3" />
      <div className="h-7 w-20 bg-slate-700/40 rounded animate-pulse" />
    </div>
  );
}
