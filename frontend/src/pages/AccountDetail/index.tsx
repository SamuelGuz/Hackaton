import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { RiskBadge } from "../../components/RiskBadge";
import { Timeline } from "../../components/Timeline";
import { ScoreBar } from "../../components/ScoreBar";
import { InterventionModal } from "../../components/InterventionModal";
import { humanize, formatArr, formatRenewal, daysUntil } from "../../utils/format";

const SVG = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const severityClass = (sev: string) =>
  sev === "high"   ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
  sev === "medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                     "bg-slate-700/40 text-slate-300 border-slate-600/40";

const severityLabel = (sev: string) =>
  sev === "high" ? "Alta" : sev === "medium" ? "Media" : "Baja";

function MetricBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1">{label}</p>
      <p className="text-base font-semibold text-slate-100 tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { account, events, loading, error } = useAccount(id);
  const [modalOpen, setModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="h-32 bg-slate-900/60 rounded-xl animate-pulse mb-6" />
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 h-96 bg-slate-900/60 rounded-xl animate-pulse" />
          <div className="h-96 bg-slate-900/60 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="max-w-7xl mx-auto p-12 text-center text-rose-400 text-sm">
        {error ?? "Cuenta no encontrada"}
      </div>
    );
  }

  const renewal = formatRenewal(account.contractRenewalDate);
  const daysToRenewal = daysUntil(account.contractRenewalDate);
  const seatsPct = Math.round((account.seatsActive / account.seatsPurchased) * 100);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors">
        <svg {...SVG} width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
        Volver al dashboard
      </Link>

      {/* Hero header */}
      <header className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-6">
          <CompanyAvatar name={account.name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white tracking-tight">{account.name}</h1>
              <RiskBadge status={account.health.status} />
            </div>
            <p className="text-sm text-slate-400">
              {humanize(account.industry)} · {humanize(account.size)} · {humanize(account.geography)} · CSM <span className="text-slate-300">{account.csmAssigned}</span>
            </p>
          </div>
        </div>

        {/* Métricas hero */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 pt-4 border-t border-slate-800">
          <MetricBlock label="ARR" value={formatArr(account.arrUsd)} sub={`Plan ${account.plan}`} />
          <MetricBlock
            label="Seats"
            value={`${account.seatsActive} / ${account.seatsPurchased}`}
            sub={`${seatsPct}% activos`}
          />
          <MetricBlock label="Renovación" value={renewal.label} sub={new Date(account.contractRenewalDate).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} />
          <MetricBlock
            label="Champion"
            value={account.champion.name}
            sub={account.champion.changedRecently ? "⚠ cambió recientemente" : account.champion.role}
          />
          <MetricBlock
            label="Último QBR"
            value={account.lastQbrDate ? new Date(account.lastQbrDate).toLocaleDateString("es", { month: "short", year: "numeric" }) : "—"}
            sub={account.lastQbrDate ? `Hace ${Math.floor((Date.now() - new Date(account.lastQbrDate).getTime()) / (1000*60*60*24*30))} meses` : undefined}
          />
        </div>
      </header>

      {/* Two column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline (col 1-2) */}
        <section className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Actividad reciente
            </h2>
            <span className="text-[11px] text-slate-500">{events.length} eventos</span>
          </div>
          <Timeline events={events} />
        </section>

        {/* Right rail (sticky) */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* Crystal Ball card */}
          <div className="bg-gradient-to-br from-rose-500/10 to-slate-900/40 border border-rose-500/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-md bg-rose-500/20 flex items-center justify-center">
                <svg {...SVG} className="text-rose-300"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>
              </div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-rose-300">
                Crystal Ball · Riesgo de churn
              </p>
            </div>

            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-4xl font-bold tabular-nums text-rose-300">{account.health.churnRiskScore}</span>
              <span className="text-sm text-slate-500">/ 100</span>
            </div>

            <ScoreBar score={account.health.churnRiskScore} variant="risk" />

            <div className="mt-4 space-y-1.5">
              {account.health.topSignals.map((s) => (
                <div key={s.signal} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{humanize(s.signal)}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${severityClass(s.severity)}`}>
                    {severityLabel(s.severity)} · {s.value}
                  </span>
                </div>
              ))}
            </div>

            <details className="mt-4 group">
              <summary className="cursor-pointer text-[11px] text-rose-300 hover:text-rose-200 font-medium select-none flex items-center gap-1">
                <svg {...SVG} width="12" height="12" className="transition-transform group-open:rotate-90"><polyline points="9 18 15 12 9 6"/></svg>
                Ver razonamiento del agente
              </summary>
              <p className="text-xs text-slate-400 leading-relaxed mt-2.5 pl-3 border-l-2 border-rose-500/30">
                {account.health.crystalBallReasoning}
              </p>
            </details>
          </div>

          {/* Expansion card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-md bg-sky-500/20 flex items-center justify-center">
                <svg {...SVG} className="text-sky-300"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              </div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-sky-300">
                Expansion Trigger
              </p>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold tabular-nums text-sky-300">{account.health.expansionScore}</span>
              <span className="text-xs text-slate-500">/ 100</span>
              {account.health.readyToExpand && (
                <span className="ml-auto text-[10px] uppercase tracking-widest font-semibold text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded">
                  Listo
                </span>
              )}
            </div>
            <ScoreBar score={account.health.expansionScore} variant="expansion" />
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              {account.health.readyToExpand
                ? "Cuenta lista para upgrade. Ver playbook propuesto en la modal de intervención."
                : "Sin oportunidad de expansion clara hoy. Foco en retención primero."}
            </p>
          </div>

          {/* CTA principal */}
          <button
            onClick={() => setModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-gradient-to-br from-rose-500 to-orange-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-rose-500/20 hover:from-rose-400 hover:to-orange-400 hover:shadow-rose-500/40 transition-all"
          >
            <svg {...SVG} strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
            Ejecutar intervención
          </button>

          <p className="text-[10px] text-center text-slate-500">
            {daysToRenewal > 0
              ? `${daysToRenewal} días para la renovación · actuá ahora`
              : "Renovación vencida · prioridad máxima"}
          </p>
        </aside>
      </div>

      {modalOpen && (
        <InterventionModal
          accountId={account.id}
          accountName={account.name}
          championName={account.champion.name}
          championEmail={account.champion.email}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
