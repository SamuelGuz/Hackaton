import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts } from "../../hooks/useAccounts";
import { RiskBadge } from "../../components/RiskBadge";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { ScoreBar } from "../../components/ScoreBar";
import { SkeletonRow, SkeletonCard } from "../../components/Skeleton";
import { humanize, formatArr, formatRenewal } from "../../utils/format";
import type { AccountFilter } from "../../api/accounts";

const FILTERS: { label: string; value: AccountFilter }[] = [
  { label: "Todas", value: "all" },
  { label: "En riesgo", value: "at_risk" },
  { label: "Expansión", value: "expansion" },
];

const renewalToneClass: Record<"urgent" | "soon" | "normal", string> = {
  urgent: "text-rose-300 bg-rose-500/10",
  soon:   "text-amber-300 bg-amber-500/10",
  normal: "text-slate-400 bg-slate-700/30",
};

function StatCard({
  label, value, accent, icon, sub,
}: { label: string; value: string | number; accent: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-slate-900/70 rounded-lg p-4 border border-slate-800 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <p className="text-slate-500 text-[11px] uppercase tracking-widest font-semibold">{label}</p>
        <span className={accent}>{icon}</span>
      </div>
      <p className={`text-3xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
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
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [search, setSearch] = useState("");
  const { accounts, stats, loading, error } = useAccounts(filter, search);

  const lastSync = useMemo(() => new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }), []);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Health Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Centro de comando de Customer Success · Sincronizado a las {lastSync}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Datos en vivo
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          <>
            <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          </>
        ) : (
          <>
            <StatCard label="Total cuentas" value={stats.total} accent="text-slate-100" icon={icons.total} sub={`${stats.total} activas`} />
            <StatCard label="En riesgo" value={stats.atRisk} accent="text-rose-400" icon={icons.risk} sub={`${stats.total ? ((stats.atRisk / stats.total) * 100).toFixed(0) : 0}% del portafolio`} />
            <StatCard label="Expansión lista" value={stats.expansion} accent="text-sky-400" icon={icons.expand} sub="oportunidades activas" />
            <StatCard label="ARR en riesgo" value={formatArr(stats.arrAtRisk)} accent="text-amber-400" icon={icons.arr} sub="anualizado · USD" />
          </>
        )}
      </div>

      {/* Filter + search bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-900/70 border border-slate-800 rounded-lg p-1">
          {FILTERS.map((f) => {
            const count =
              f.value === "all" ? stats.total :
              f.value === "at_risk" ? stats.atRisk :
              stats.expansion;
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
                <span className={`text-[11px] px-1.5 py-0.5 rounded tabular-nums ${active ? "bg-slate-900 text-slate-300" : "bg-slate-800 text-slate-500"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icons.search}</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar empresa, industria o CSM..."
            className="bg-slate-900/70 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/60 focus:bg-slate-900 w-72 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900/40 rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-500 text-[11px] uppercase tracking-widest">
              <th className="text-left px-4 py-3 font-semibold">Empresa</th>
              <th className="text-left px-4 py-3 font-semibold">Industria · Plan</th>
              <th className="text-right px-4 py-3 font-semibold">ARR</th>
              <th className="text-center px-4 py-3 font-semibold">Riesgo de churn</th>
              <th className="text-center px-4 py-3 font-semibold">Expansión</th>
              <th className="text-left px-4 py-3 font-semibold">Renovación</th>
              <th className="text-left px-4 py-3 font-semibold">CSM</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

            {error && (
              <tr><td colSpan={7} className="p-12 text-center text-rose-400">Error al cargar: {error}</td></tr>
            )}

            {!loading && !error && accounts.length === 0 && (
              <tr><td colSpan={7} className="p-12 text-center text-slate-500">
                <p className="text-base mb-1">Sin resultados</p>
                <p className="text-xs">Probá con otro filtro o búsqueda.</p>
              </td></tr>
            )}

            {!loading && !error && accounts.map((a) => {
              const renewal = formatRenewal(a.contractRenewalDate);
              return (
                <tr
                  key={a.id}
                  tabIndex={0}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter") navigate(`/accounts/${a.id}`); }}
                  className="border-b border-slate-800/60 last:border-0 cursor-pointer transition-colors hover:bg-slate-800/40 focus:bg-slate-800/40 focus:outline-none group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CompanyAvatar name={a.name} />
                      <div>
                        <div className="font-medium text-slate-100 group-hover:text-white">{a.name}</div>
                        <div className="mt-0.5"><RiskBadge status={a.healthStatus} /></div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <div className="text-xs">{humanize(a.industry)}</div>
                    <div className="text-[11px] text-slate-500 capitalize">{a.plan}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-200 font-medium">{formatArr(a.arrUsd)}</td>
                  <td className="px-4 py-3"><ScoreBar score={a.churnRiskScore} variant="risk" /></td>
                  <td className="px-4 py-3"><ScoreBar score={a.expansionScore} variant="expansion" /></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-[11px] font-medium ${renewalToneClass[renewal.tone]}`}>
                      {renewal.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{a.csmAssigned}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
