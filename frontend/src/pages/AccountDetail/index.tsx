import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useInterventions } from "../../hooks/useInterventions";
import { useHealthHistory } from "../../hooks/useHealthHistory";
import { useI18n } from "../../context/I18nContext";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { RiskBadge } from "../../components/RiskBadge";
import { Timeline } from "../../components/Timeline";
import { HealthHistoryTable } from "../../components/HealthHistoryTable";
import { ScoreBar } from "../../components/ScoreBar";
import { InterventionModal } from "../../components/InterventionModal";
import { VoiceCallPanel } from "../../components/VoiceCallPanel";
import { SurfaceCard } from "../../components/SurfaceCard";
import { humanizeI18n, formatArr, formatRenewal, daysUntil } from "../../utils/format";
import { isOpenInterventionStatus } from "../../constants/interventions";

const SVG = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

// Estados no terminales: bloquean lanzar una intervención nueva.
// Terminales: `rejected`, `failed` o cualquiera con outcome != null.
// `responded` se considera abierto hasta que un CSM registre el outcome.
const OPEN_INTERVENTION_STATUSES: InterventionStatus[] = [
  "pending_approval",
  "pending",
  "sent",
  "delivered",
  "opened",
  "responded",
];

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
  const navigate = useNavigate();
  const { account, events, loading, error } = useAccount(id);
  const {
    interventions: accountInterventions,
    loading: interventionsLoading,
    refetch: refetchInterventions,
  } = useInterventions(id ? { accountId: id } : {});
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "history">("activity");
  const {
    items: historyItems,
    loading: historyLoading,
    error: historyError,
  } = useHealthHistory(id, activeTab === "history");
  const [voiceSession, setVoiceSession] = useState<{
    interventionId: string;
    signedUrl: string;
    triggerReason?: string;
    messageBody?: string;
    championName?: string;
    companyName?: string;
    csmName?: string;
  } | null>(null);

  // Una intervención está "activa" si todavía no terminó su ciclo (no resuelta, no rechazada).
  // Mientras la lista carga devolvemos `null` para evitar abrir el modal en un falso "limpio"
  // (race que dispara un POST /agents/intervention y duplica fila).
  const interventionsReady = !interventionsLoading;
  const activeIntervention = useMemo(() => {
    if (!interventionsReady) return null;
    return (
      accountInterventions.find((i) =>
        OPEN_INTERVENTION_STATUSES.includes(i.status)
      ) ?? null
    );
  }, [accountInterventions, interventionsReady]);
  const hasActiveIntervention = activeIntervention !== null;
  const ctaGateLoading = !interventionsReady;

  useEffect(() => {
    if (!interventionsLoading && hasActiveIntervention && modalOpen) {
      setModalOpen(false);
    }
  }, [interventionsLoading, hasActiveIntervention, modalOpen]);

  const severityClass = (sev: string) =>
    sev === "high"   ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
    sev === "medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                       "bg-slate-700/40 text-slate-300 border-slate-600/40";

  const severityLabel = (sev: string) =>
    sev === "high" ? t("detail.severityHigh") : sev === "medium" ? t("detail.severityMed") : t("detail.severityLow");

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
        {error ?? "Account not found"}
      </div>
    );
  }

  const renewal = formatRenewal(account.contractRenewalDate, t as any);
  const daysToRenewal = daysUntil(account.contractRenewalDate);
  const seatsPct = account.seatsPurchased > 0
    ? Math.round((account.seatsActive / account.seatsPurchased) * 100)
    : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors">
        <svg {...SVG} width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
        {t("detail.backLabel")}
      </Link>

      {/* Hero header */}
      <SurfaceCard weight="panel" tone="indigo" hoverLift={false} motionIndex={0} className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <CompanyAvatar name={account.name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white tracking-tight">{account.name}</h1>
              <RiskBadge status={account.health.status} />
            </div>
            {account.accountNumber?.trim() ? (
              <p className="text-xs text-slate-500 tabular-nums mb-1">
                {t("dash.colAccountNumber")}: <span className="text-slate-300">{account.accountNumber}</span>
              </p>
            ) : null}
            <p className="text-sm text-slate-400">
              {humanizeI18n(account.industry, t)} · {humanizeI18n(account.size, t)} · {humanizeI18n(account.geography, t)} · CSM <span className="text-slate-300">{account.csm.name}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 pt-4 border-t border-slate-800">
          <MetricBlock label={t("detail.labelArr")} value={formatArr(account.arrUsd)} sub={`Plan ${account.plan}`} />
          <MetricBlock
            label={t("detail.labelSeats")}
            value={`${account.seatsActive} / ${account.seatsPurchased}`}
            sub={`${seatsPct}% ${t("detail.labelSeatsActive")}`}
          />
          <MetricBlock label={t("detail.labelRenewal")} value={renewal.label} sub={new Date(account.contractRenewalDate).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} />
          <MetricBlock
            label={t("detail.labelChampion")}
            value={account.champion.name}
            sub={account.champion.changedRecently ? t("detail.champChanged") : account.champion.role}
          />
          <MetricBlock
            label={t("detail.labelQbr")}
            value={account.lastQbrDate ? new Date(account.lastQbrDate).toLocaleDateString("es", { month: "short", year: "numeric" }) : "—"}
            sub={account.lastQbrDate ? `${t("detail.labelMonthsAgo")} ${Math.floor((Date.now() - new Date(account.lastQbrDate).getTime()) / (1000*60*60*24*30))}` : undefined}
          />
        </div>
      </SurfaceCard>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SurfaceCard weight="panel" tone="neutral" hoverLift={false} motionIndex={1} className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
            <div role="tablist" aria-label="Account detail sections" className="relative inline-flex p-0.5 bg-slate-900/60 border border-slate-800/80 rounded-lg">
              {(["activity", "history"] as const).map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="account-detail-tab-pill"
                        className="absolute inset-0 bg-slate-800/80 border border-slate-700/80 rounded-md"
                        transition={{ type: "spring", stiffness: 500, damping: 36 }}
                      />
                    )}
                    <span className="relative z-[1]">
                      {tab === "activity" ? t("detail.activity") : t("history.tab")}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {activeTab === "activity"
                ? `${events.length} ${t("detail.events")}`
                : historyLoading
                ? t("history.loading")
                : `${historyItems.length} ${t("history.snapshots")}`}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "activity" ? (
              <motion.div
                key="activity"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <Timeline events={events} />
              </motion.div>
            ) : (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <HealthHistoryTable
                  items={historyItems}
                  loading={historyLoading}
                  error={historyError}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </SurfaceCard>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {voiceSession && (
            <VoiceCallPanel
              interventionId={voiceSession.interventionId}
              signedUrl={voiceSession.signedUrl}
              triggerReason={voiceSession.triggerReason ?? ""}
              messageBody={voiceSession.messageBody ?? ""}
              championName={voiceSession.championName ?? account.champion.name}
              companyName={voiceSession.companyName ?? account.name}
              csmName={voiceSession.csmName ?? account.csm.name}
              onClose={() => setVoiceSession(null)}
            />
          )}

          {/* Crystal Ball */}
          <SurfaceCard tone="rose" motionIndex={2} className="p-5 bg-[linear-gradient(155deg,rgba(190,18,60,0.08)_0%,rgba(10,12,18,0.92)_55%,rgba(6,8,14,0.96)_100%)]">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-md bg-rose-500/20 flex items-center justify-center">
                <svg {...SVG} className="text-rose-300"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>
              </div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-rose-300">
                {t("detail.crystalBall")}
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
                  <span className="text-slate-300">{humanizeI18n(s.signal, t)}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${severityClass(s.severity)}`}>
                    {severityLabel(s.severity)} · {s.value}
                  </span>
                </div>
              ))}
            </div>
            <details className="mt-4 group">
              <summary className="cursor-pointer text-[11px] text-rose-300 hover:text-rose-200 font-medium select-none flex items-center gap-1">
                <svg {...SVG} width="12" height="12" className="transition-transform group-open:rotate-90"><polyline points="9 18 15 12 9 6"/></svg>
                {t("detail.seeReasoning")}
              </summary>
              <p className="text-xs text-slate-400 leading-relaxed mt-2.5 pl-3 border-l-2 border-rose-500/30">
                {account.health.crystalBallReasoning}
              </p>
            </details>
          </SurfaceCard>

          {/* Expansion */}
          <SurfaceCard tone="sky" motionIndex={3} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-md bg-sky-500/20 flex items-center justify-center">
                <svg {...SVG} className="text-sky-300"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              </div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-sky-300">
                {t("detail.expansion")}
              </p>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold tabular-nums text-sky-300">{account.health.expansionScore}</span>
              <span className="text-xs text-slate-500">/ 100</span>
              {account.health.readyToExpand && (
                <span className="ml-auto text-[10px] uppercase tracking-widest font-semibold text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded">
                  {t("detail.expandReady")}
                </span>
              )}
            </div>
            <ScoreBar score={account.health.expansionScore} variant="expansion" />
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              {account.health.readyToExpand ? t("detail.expandYes") : t("detail.expandNo")}
            </p>
          </SurfaceCard>

          {/* CTA */}
          {ctaGateLoading ? (
            <div className="w-full">
              <button
                disabled
                aria-busy="true"
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800/60 border border-slate-700/60 text-slate-400 text-sm font-semibold rounded-xl cursor-wait"
              >
                <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
                {t("detail.ctaLoading")}
              </button>
            </div>
          ) : hasActiveIntervention ? (
            <div className="w-full">
              <button
                disabled
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-semibold rounded-xl cursor-not-allowed"
              >
                <svg {...SVG} strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {t("detail.ctaActiveTitle")}
              </button>
              <p className="text-[11px] text-center text-amber-300/80 mt-2 leading-relaxed">
                {t("detail.ctaActiveBody", {
                  status: t(`inv.status.${activeIntervention!.status}` as string) || activeIntervention!.status,
                })}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/interventions?account=${account.id}`)}
                className="mt-2 w-full text-[11px] text-indigo-300 hover:text-indigo-200 font-medium transition-colors"
              >
                {t("detail.ctaActiveLink")} →
              </button>
            </div>
          ) : (
            <>
              <button
                disabled={interventionsLoading}
                onClick={() => setModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-gradient-to-br from-rose-500 to-orange-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-rose-500/20 hover:from-rose-400 hover:to-orange-400 hover:shadow-rose-500/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {interventionsLoading
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <svg {...SVG} strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                }
                {t("detail.ctaButton")}
              </button>

              <p className="text-[10px] text-center text-slate-500">
                {daysToRenewal > 0
                  ? `${daysToRenewal} ${t("detail.renewalUrgent")}`
                  : t("detail.renewalExpired")}
              </p>
            </>
          )}
        </aside>
      </div>

      {modalOpen && (
        <InterventionModal
          accountId={account.id}
          accountName={account.name}
          champion={account.champion}
          onClose={() => {
            setModalOpen(false);
            refetchInterventions();
          }}
          onLaunched={refetchInterventions}
          onVoiceSessionStart={(payload) => setVoiceSession(payload)}
        />
      )}
    </div>
  );
}
