import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts } from "../../hooks/useAccounts";
import { useI18n } from "../../context/I18nContext";
import { RiskBadge } from "../../components/RiskBadge";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { ScoreBar } from "../../components/ScoreBar";
import { SkeletonRow, SkeletonCard } from "../../components/Skeleton";
import { SurfaceCard } from "../../components/SurfaceCard";
import type { SurfaceTone } from "../../components/SurfaceCard";
import { Sparkline } from "../../components/Sparkline";
import { FilterPillGroup } from "../../components/FilterPillGroup";
import { humanizeI18n, formatArr, formatRenewal } from "../../utils/format";
import type { AccountFilter } from "../../api/accounts";

const renewalToneClass: Record<"urgent" | "soon" | "normal", string> = {
  urgent: "text-rose-300 bg-rose-500/10",
  soon:   "text-amber-300 bg-amber-500/10",
  normal: "text-slate-400 bg-slate-700/30",
};

function StatCard({
  label, value, accent, icon, sub, tone, motionIndex, sparklineSeries,
}: {
  label: string;
  value: string | number;
  accent: string;
  icon: ReactNode;
  sub?: string;
  tone: SurfaceTone;
  motionIndex: number;
  /** Serie temporal cuando el backend la exponga (p. ej. histórico diario). */
  sparklineSeries?: number[];
}) {
  return (
    <SurfaceCard tone={tone} motionIndex={motionIndex} className="p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-slate-500 text-[11px] uppercase tracking-widest font-semibold">{label}</p>
        <span className="text-slate-500 group-hover:text-slate-400 transition-colors duration-300 [&>svg]:opacity-90">
          {icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className={`text-3xl font-bold tabular-nums ${accent}`}>{value}</p>
        <Sparkline series={sparklineSeries} className="shrink-0 opacity-85" />
      </div>
      {sub && <p className="text-xs text-slate-500 mt-1 leading-snug">{sub}</p>}
    </SurfaceCard>
  );
}

const icons = {
  total:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  risk:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  expand: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  arr:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [activeFilter, setActiveFilter] = useState<AccountFilter>("all");
  const [search, setSearch] = useState("");
  const { accounts, stats, loading, error, lastFetchedAt, refetch } = useAccounts(activeFilter, search);

  const FILTERS: { label: string; value: AccountFilter }[] = [
    { label: t("dash.filterAll"),    value: "all" },
    { label: t("dash.filterRisk"),   value: "at_risk" },
    { label: t("dash.filterExpand"), value: "expansion" },
  ];

  const syncTime =
    lastFetchedAt != null
      ? lastFetchedAt.toLocaleTimeString(lang === "es" ? "es" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const filtersDirty = activeFilter !== "all" || search.trim().length > 0;
  const hasSourceData = stats.total > 0;
  const filteredEmpty = !loading && !error && accounts.length === 0 && hasSourceData;
  const trulyEmpty = !loading && !error && accounts.length === 0 && !hasSourceData;

  const resetFilters = () => {
    setActiveFilter("all");
    setSearch("");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="relative -mx-2 px-2 pt-1">
        <div className="co-dash-hero" aria-hidden />
        <div className="co-dash-hero-wrap space-y-4">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">{t("dash.title")}</h1>
              <p className="text-sm text-slate-400 mt-1">
                {t("dash.subtitle")} {syncTime}
              </p>
            </div>
          </div>

          {!loading && !error && stats.total > 0 && (
            <p className="text-sm text-slate-400 max-w-3xl leading-relaxed border border-slate-800/80 rounded-xl px-4 py-3 bg-slate-900/40">
              <span className="text-indigo-300/90 font-medium">
                {t("dash.insightLine", {
                  risk: stats.atRisk,
                  arr: formatArr(stats.arrAtRisk),
                })}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCard label={t("dash.statTotal")} value={stats.total} accent="text-slate-100" icon={icons.total} sub={`${stats.total} ${t("dash.statActive")}`} tone="neutral" motionIndex={0} />
            <StatCard label={t("dash.statRisk")} value={stats.atRisk} accent="text-rose-400" icon={icons.risk} sub={`${stats.total ? ((stats.atRisk / stats.total) * 100).toFixed(0) : 0}% ${t("dash.statRiskSub")}`} tone="rose" motionIndex={1} />
            <StatCard label={t("dash.statExpand")} value={stats.expansion} accent="text-sky-400" icon={icons.expand} sub={t("dash.statExpandSub")} tone="sky" motionIndex={2} />
            <StatCard label={t("dash.statArr")} value={formatArr(stats.arrAtRisk)} accent="text-amber-400" icon={icons.arr} sub={t("dash.statArrSub")} tone="amber" motionIndex={3} />
          </>
        )}
      </div>

      {/* Filter + search */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterPillGroup
            layoutId="co-pill-dash-accounts"
            value={activeFilter}
            onChange={setActiveFilter}
            options={FILTERS.map((f) => {
              const count = f.value === "all" ? stats.total : f.value === "at_risk" ? stats.atRisk : stats.expansion;
              const active = activeFilter === f.value;
              return {
                value: f.value,
                label: f.label,
                suffix: (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded tabular-nums transition-colors duration-200 ${
                      active ? "bg-slate-900 text-slate-300" : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                ),
              };
            })}
          />
          {filtersDirty && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-indigo-300/90 hover:text-indigo-200 border border-indigo-500/25 hover:border-indigo-400/40 rounded-lg px-3 py-2 bg-indigo-950/20 transition-colors"
            >
              {t("dash.resetFilters")}
            </button>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icons.search}</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dash.searchPlaceholder")}
            className="bg-slate-900/70 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/25 focus:bg-slate-900 w-72 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <SurfaceCard weight="panel" tone="neutral" surface="data" hoverLift={false} motionIndex={4} className="overflow-hidden">
        <div className="co-table-wrap">
          <div className="co-table-shell">
            <table className="co-table text-sm">
          <thead>
            <tr>
              <th>{t("dash.colCompany")}</th>
              <th>{t("dash.colIndustryPlan")}</th>
              <th className="text-right">{t("dash.colArr")}</th>
              <th className="text-center">{t("dash.colChurn")}</th>
              <th className="text-center">{t("dash.colExpand")}</th>
              <th>{t("dash.colRenewal")}</th>
              <th>{t("dash.colCsm")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

            {error && (
              <tr>
                <td colSpan={7} className="py-12 text-center align-middle">
                  <p className="text-sm text-rose-400 mb-4">Error: {error}</p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="inline-flex items-center justify-center rounded-lg border border-indigo-500/35 bg-indigo-950/40 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900/50 hover:border-indigo-400/50 transition-colors"
                  >
                    {t("dash.errorRetry")}
                  </button>
                </td>
              </tr>
            )}

            {!loading && !error && trulyEmpty && (
              <tr>
                <td colSpan={7} className="py-12 text-center align-middle">
                  <p className="text-base text-slate-400 mb-1">{t("global.noResults")}</p>
                  <p className="text-xs text-slate-500 mb-5">{t("global.tryFilter")}</p>
                  <button
                    type="button"
                    onClick={() => navigate("/upload")}
                    className="inline-flex items-center justify-center rounded-lg border border-indigo-500/35 bg-indigo-950/40 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900/50 transition-colors"
                  >
                    {t("dash.emptyImportCta")}
                  </button>
                </td>
              </tr>
            )}

            {!loading && !error && filteredEmpty && (
              <tr>
                <td colSpan={7} className="py-12 text-center align-middle">
                  <p className="text-base text-slate-400 mb-1">{t("global.noResults")}</p>
                  <p className="text-xs text-slate-500 mb-5">{t("global.tryFilter")}</p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
                    >
                      {t("dash.emptyResetCta")}
                    </button>
                    {search.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="inline-flex items-center justify-center rounded-lg border border-indigo-500/35 bg-indigo-950/40 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900/50 transition-colors"
                      >
                        {t("dash.emptyClearSearch")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {!loading && !error && accounts.map((a) => {
              const renewal = formatRenewal(a.contractRenewalDate, t);
              return (
                <tr
                  key={a.id}
                  tabIndex={0}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter") navigate(`/accounts/${a.id}`); }}
                  className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40 focus-visible:z-10 group"
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <CompanyAvatar name={a.name} />
                      <div>
                        <div className="font-medium text-slate-100 group-hover:text-white">{a.name}</div>
                        <div className="mt-0.5"><RiskBadge status={a.healthStatus} /></div>
                      </div>
                    </div>
                  </td>
                  <td className="text-slate-300">
                    <div className="text-xs">{humanizeI18n(a.industry, t)}</div>
                    <div className="text-[11px] text-slate-500 capitalize">{a.plan}</div>
                  </td>
                  <td className="text-right tabular-nums text-slate-200 font-medium">{formatArr(a.arrUsd)}</td>
                  <td className="text-center"><ScoreBar score={a.churnRiskScore} variant="risk" /></td>
                  <td className="text-center"><ScoreBar score={a.expansionScore} variant="expansion" /></td>
                  <td>
                    <span className={`px-2 py-1 rounded text-[11px] font-medium ${renewalToneClass[renewal.tone]}`}>
                      {renewal.label}
                    </span>
                  </td>
                  <td className="text-slate-400 text-xs">{a.csm.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
