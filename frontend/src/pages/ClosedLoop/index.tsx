import { useMemo, useState } from "react";
import { FilterPillGroup } from "../../components/FilterPillGroup";
import { usePlaybooks } from "../../hooks/usePlaybooks";
import { useI18n } from "../../context/I18nContext";
import { PlaybookEvolutionCard } from "../../components/PlaybookEvolutionCard";
import { PlaybookRow } from "../../components/PlaybookRow";
import { SurfaceCard } from "../../components/SurfaceCard";
import type { SurfaceTone } from "../../components/SurfaceCard";
import { useCountUp } from "../../hooks/useCountUp";
import type { Playbook } from "../../types";

type Sort = "best" | "worst" | "most_used";

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

function StatBlock({
  label, value, suffix, sub, accent = "text-slate-100", tone, motionIndex,
}: {
  label: string;
  value: number;
  suffix?: string;
  sub: string;
  accent?: string;
  tone: SurfaceTone;
  motionIndex: number;
}) {
  const animated = useCountUp(value, 1000);
  const display = suffix === "%" ? animated.toFixed(0) : Math.round(animated).toString();
  return (
    <SurfaceCard tone={tone} motionIndex={motionIndex} className="p-4">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent}`}>
        {display}<span className="text-base font-normal text-slate-500">{suffix}</span>
      </p>
      <p className="text-[11px] text-slate-500 mt-1 leading-snug">{sub}</p>
    </SurfaceCard>
  );
}

export default function ClosedLoop() {
  const { playbooks, featured, stats, loading, error } = usePlaybooks();
  const { t } = useI18n();
  const [sort, setSort] = useState<Sort>("best");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const SORTS: { label: string; value: Sort }[] = [
    { label: t("cl.sortBest"),  value: "best" },
    { label: t("cl.sortWorst"), value: "worst" },
    { label: t("cl.sortUsed"),  value: "most_used" },
  ];

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

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center text-rose-400 text-sm">
        {error}
      </div>
    );
  }

  const succPct = stats.avgSuccessRate * 100;

  return (
    <div className="max-w-6xl mx-auto space-y-7">
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <svg {...SVG} className="text-emerald-300"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
            {t("cl.badge")}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("cl.title")}</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t("cl.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBlock label={t("cl.statActive")} value={stats.total} sub={t("cl.statActiveSub")} accent="text-slate-100" tone="neutral" motionIndex={0} />
        <StatBlock label={t("cl.statUses")} value={stats.totalUses} sub={t("cl.statUsesSub")} accent="text-slate-100" tone="indigo" motionIndex={1} />
        <StatBlock label={t("cl.statRate")} value={succPct} suffix="%" sub={t("cl.statRateSub")} accent="text-emerald-300" tone="emerald" motionIndex={2} />
        <StatBlock label={t("cl.statIter")} value={stats.versionsLearned} sub={t("cl.statIterSub")} accent="text-indigo-300" tone="violet" motionIndex={3} />
      </div>

      {featured ? (
        <PlaybookEvolutionCard evolution={featured} />
      ) : (
        <SurfaceCard weight="panel" tone="neutral" surface="data" hoverLift={false} motionIndex={1} className="p-6">
          <p className="text-sm font-medium text-slate-200">{t("cl.noEvolutionTitle")}</p>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-2xl">{t("cl.noEvolutionBody")}</p>
        </SurfaceCard>
      )}

      <SurfaceCard weight="panel" tone="neutral" surface="data" hoverLift={false} motionIndex={4} className="overflow-hidden">
        <header className="px-6 py-4 border-b border-slate-800/70 flex items-center justify-between flex-wrap gap-3 bg-slate-950/20">
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">{t("cl.libTitle")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("cl.libEntries", { n: playbooks.length })} {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
            </p>
          </div>
          <FilterPillGroup
            layoutId="co-pill-cl-sort"
            value={sort}
            onChange={setSort}
            size="sm"
            options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </header>

        <div className="co-table-wrap">
          <div className="co-table-shell">
            <table className="co-table text-sm">
          <thead>
            <tr>
              <th className="text-right tabular-nums w-[2rem] min-w-[2rem] max-w-[2rem] px-1.5 align-middle">{t("dash.colIndex")}</th>
              <th>{t("cl.colPlaybook")}</th>
              <th>{t("cl.colProfile")}</th>
              <th className="text-right">{t("cl.colUses")}</th>
              <th className="text-right">{t("cl.colRate")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p: Playbook, idx) => (
              <PlaybookRow
                key={p.id}
                index={idx + 1}
                playbook={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onJumpTo={jumpTo}
                byId={byId}
              />
            ))}
          </tbody>
        </table>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
