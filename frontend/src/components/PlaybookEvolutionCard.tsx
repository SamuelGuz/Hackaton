import { ChannelIcon } from "./ChannelIcon";
import { useCountUp } from "../hooks/useCountUp";
import { useI18n } from "../context/I18nContext";
import type { Playbook } from "../types";
import type { FeaturedEvolution } from "../api/playbooks";

function PlaybookSide({
  playbook, variant,
}: {
  playbook: Playbook;
  variant: "before" | "after";
}) {
  const { t } = useI18n();
  const successPct = useCountUp(playbook.successRate * 100, 1100);
  const isAfter = variant === "after";

  const headerLabel = isAfter ? t("cl.evoAfter") : t("cl.evoBefore");
  const headerClass = isAfter
    ? "text-emerald-300 bg-emerald-500/10"
    : "text-slate-400 bg-slate-700/40 line-through decoration-slate-500/40";
  const cardClass = isAfter
    ? "bg-gradient-to-br from-emerald-500/10 to-slate-900/40 border-emerald-500/40 shadow-lg shadow-emerald-500/10"
    : "bg-slate-900/40 border-slate-800 opacity-80";

  return (
    <div className={`relative flex flex-col rounded-xl border p-5 ${cardClass}`}>
      <span className={`inline-block self-start text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded mb-3 ${headerClass}`}>
        {headerLabel}
      </span>

      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isAfter ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-500 grayscale"}`}>
          <ChannelIcon channel={playbook.recommendedChannel} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100 leading-tight">
            {t(`channel.${playbook.recommendedChannel}` as any)}
          </p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">v{playbook.version}</p>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-bold tabular-nums ${isAfter ? "text-emerald-300" : "text-slate-400"}`}>
            {Math.round(successPct)}
          </span>
          <span className="text-lg text-slate-500">%</span>
          <span className="ml-2 text-[11px] text-slate-500">{t("cl.evoRate")}</span>
        </div>
        <div className="mt-2 w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ${isAfter ? "bg-emerald-400" : "bg-slate-500"}`}
            style={{ width: `${successPct}%` }}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
          {playbook.timesSucceeded} {t("cl.evoUses")} / {playbook.timesUsed} {t("cl.evoOf")}
        </p>
      </div>

      <div className="mt-auto">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
          {t("cl.evoTemplate")}
        </p>
        <blockquote className={`text-xs leading-relaxed border-l-2 pl-3 italic ${isAfter ? "border-emerald-500/40 text-slate-300" : "border-slate-700 text-slate-500"}`}>
          "{playbook.messageTemplate}"
        </blockquote>
      </div>
    </div>
  );
}

export function PlaybookEvolutionCard({ evolution }: { evolution: FeaturedEvolution }) {
  const { t } = useI18n();
  const delta = (evolution.after.successRate - evolution.before.successRate) * 100;
  const multiplier = (evolution.after.successRate / Math.max(evolution.before.successRate, 0.01)).toFixed(1);

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-300">
          {t("cl.evoLabel")}
        </span>
      </div>
      <h2 className="text-xl font-bold text-white tracking-tight mb-1">{t("cl.evoTitle")}</h2>
      <p className="text-sm text-slate-400 mb-5">
        <span className="text-slate-300">Pre-churn · Fintech mid-market</span>
        {" — "}{t("cl.evoTrigger")} <span className="text-rose-300 font-medium">{evolution.triggerEvent}</span>
      </p>

      <div className="relative grid md:grid-cols-2 gap-4 mb-5">
        <PlaybookSide playbook={evolution.before} variant="before" />
        <PlaybookSide playbook={evolution.after} variant="after" />
        <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center shadow-xl">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg mb-4">
        <div className="text-2xl font-bold text-emerald-300 tabular-nums shrink-0">
          +{delta.toFixed(0)}<span className="text-sm font-normal text-emerald-400/80">pp</span>
        </div>
        <div className="text-xs text-emerald-200/80 leading-snug">
          {t("cl.evoDelta", { x: multiplier })}
        </div>
      </div>

      <div className="px-4 py-3 bg-slate-800/40 border border-slate-700/60 rounded-lg">
        <div className="flex items-center gap-1.5 mb-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
          </svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
            {t("cl.evoInsight")}
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">{evolution.insight}</p>
      </div>
    </section>
  );
}
