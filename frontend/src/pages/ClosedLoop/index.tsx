import { useMemo, useState } from "react";
import { usePlaybooks } from "../../hooks/usePlaybooks";
import { PlaybookEvolutionCard } from "../../components/PlaybookEvolutionCard";
import { PlaybookRow } from "../../components/PlaybookRow";
import { useCountUp } from "../../hooks/useCountUp";
import type { Playbook } from "../../types";

type Sort = "best" | "worst" | "most_used";

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

function StatBlock({ label, value, suffix, sub, accent = "text-slate-100" }: { label: string; value: number; suffix?: string; sub: string; accent?: string }) {
  const animated = useCountUp(value, 1000);
  const display = suffix === "%" ? animated.toFixed(0) : Math.round(animated).toString();
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent}`}>
        {display}<span className="text-base font-normal text-slate-500">{suffix}</span>
      </p>
      <p className="text-[11px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

const SORTS: { label: string; value: Sort }[] = [
  { label: "Mejor desempeño", value: "best" },
  { label: "Necesita atención", value: "worst" },
  { label: "Más ejecutados", value: "most_used" },
];

export default function ClosedLoop() {
  const { playbooks, featured, stats, loading, error } = usePlaybooks();
  const [sort, setSort] = useState<Sort>("best");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...playbooks];
    if (sort === "best") list.sort((a, b) => b.successRate - a.successRate);
    if (sort === "worst") list.sort((a, b) => a.successRate - b.successRate);
    if (sort === "most_used") list.sort((a, b) => b.timesUsed - a.timesUsed);
    return list;
  }, [playbooks, sort]);

  const byId = useMemo(() => new Map(playbooks.map((p) => [p.id, p])), [playbooks]);

  const jumpTo = (id: string) => {
    setExpandedId(id);
    requestAnimationFrame(() => {
      document.getElementById(`pb-row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="h-32 bg-slate-900/60 rounded-xl animate-pulse" />
        <div className="h-96 bg-slate-900/60 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !featured) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center text-rose-400 text-sm">
        {error ?? "No se pudo cargar la memoria de playbooks"}
      </div>
    );
  }

  const succPct = stats.avgSuccessRate * 100;

  return (
    <div className="max-w-6xl mx-auto space-y-7">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <svg {...SVG} className="text-emerald-300"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
            Closed-Loop Learning
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Memoria de playbooks</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Cada intervención que el sistema lanza alimenta esta memoria. Los playbooks se reescriben automáticamente cuando dejan de funcionar — el agente se hace mejor mientras dormís.
        </p>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBlock label="Playbooks activos" value={stats.total} sub="versiones vigentes" accent="text-slate-100" />
        <StatBlock label="Intervenciones" value={stats.totalUses} sub="ejecutadas en total" accent="text-slate-100" />
        <StatBlock label="Tasa de éxito" value={succPct} suffix="%" sub="promedio ponderado" accent="text-emerald-300" />
        <StatBlock label="Iteraciones" value={stats.versionsLearned} sub="versiones aprendidas" accent="text-indigo-300" />
      </div>

      {/* Featured evolution */}
      <PlaybookEvolutionCard evolution={featured} />

      {/* Library */}
      <section className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
        <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">Biblioteca de playbooks</h2>
            <p className="text-xs text-slate-500 mt-0.5">{playbooks.length} entradas · ordenadas por {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}</p>
          </div>
          <div className="flex gap-1 bg-slate-900/70 border border-slate-800 rounded-lg p-1">
            {SORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSort(s.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  sort === s.value ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </header>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-500 text-[11px] uppercase tracking-widest">
              <th className="text-left px-4 py-3 font-semibold">Playbook</th>
              <th className="text-left px-4 py-3 font-semibold">Perfil objetivo</th>
              <th className="text-right px-4 py-3 font-semibold">Veces usado</th>
              <th className="text-right px-4 py-3 font-semibold">Tasa de éxito</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p: Playbook) => (
              <PlaybookRow
                key={p.id}
                playbook={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onJumpTo={jumpTo}
                byId={byId}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
