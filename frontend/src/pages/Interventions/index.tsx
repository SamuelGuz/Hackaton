import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useInterventions } from "../../hooks/useInterventions";
import { ChannelIcon, channelLabel } from "../../components/ChannelIcon";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { ExpandRowAccordion } from "../../components/ExpandRowAccordion";
import { SurfaceCard } from "../../components/SurfaceCard";
import type { SurfaceTone } from "../../components/SurfaceCard";
import { Sparkline } from "../../components/Sparkline";
import { FilterPillGroup } from "../../components/FilterPillGroup";
import { useCountUp } from "../../hooks/useCountUp";
import { useI18n } from "../../context/I18nContext";
import type { Intervention, InterventionStatus, InterventionOutcome } from "../../types";

const INV_COL_COUNT = 8;

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const STATUS_STYLE: Record<InterventionStatus, string> = {
  pending_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rejected:         "bg-rose-900/40  text-rose-400  border-rose-700/40",
  pending:          "bg-slate-700/40 text-slate-300  border-slate-600/40",
  sent:             "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  delivered:        "bg-indigo-500/12  text-indigo-200   border-indigo-500/28",
  opened:           "bg-sky-500/15   text-sky-300    border-sky-500/30",
  responded:        "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed:           "bg-rose-500/15  text-rose-300   border-rose-500/30",
};

const OUTCOME_STYLE: Record<InterventionOutcome, string> = {
  success:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  partial:     "bg-amber-500/15   text-amber-300   border-amber-500/30",
  no_response: "bg-slate-700/40   text-slate-400   border-slate-600/40",
  negative:    "bg-rose-500/15    text-rose-300    border-rose-500/30",
  churned:     "bg-rose-900/50    text-rose-400    border-rose-700/50",
};
const OUTCOME_ICON: Record<InterventionOutcome, string> = {
  success: "✓", partial: "~", no_response: "—", negative: "✕", churned: "⚠",
};

const statIcons = {
  total:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  pending: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  success: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  rate:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>,
};

function StatCard({
  label, value, suffix, accent, sub, tone, motionIndex, icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent: string;
  sub: string;
  tone: SurfaceTone;
  motionIndex: number;
  icon: ReactNode;
}) {
  const animated = useCountUp(value, 900);
  return (
    <SurfaceCard tone={tone} motionIndex={motionIndex} className="p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-slate-500 text-[11px] uppercase tracking-widest font-semibold">{label}</p>
        <span className="text-slate-500 group-hover:text-slate-400 transition-colors duration-300 [&>svg]:opacity-90">
          {icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className={`text-3xl font-bold tabular-nums ${accent}`}>
          {suffix === "%" ? animated.toFixed(0) : Math.round(animated)}
          {suffix ? <span className="text-base font-normal text-slate-500">{suffix}</span> : null}
        </p>
        <Sparkline className="shrink-0 opacity-85" />
      </div>
      <p className="text-xs text-slate-500 mt-1 leading-snug">{sub}</p>
    </SurfaceCard>
  );
}

function InterventionRow({
  inv, index, striped, expanded, onToggle, locale,
}: {
  inv: Intervention;
  /** Posición 1-based dentro del listado actualmente filtrado. */
  index: number;
  /** Fila alternada (zebra), sólo en la fila principal. */
  striped: boolean;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const conf = Math.round(inv.confidenceScore * 100);
  const confColor = conf >= 75 ? "text-emerald-300" : conf >= 55 ? "text-amber-300" : "text-rose-300";

  const approvalLabel = inv.autoApproved
    ? t("inv.approvalAuto")
    : inv.approvedBy
      ? t("inv.approvalCsm")
      : inv.status === "pending_approval"
        ? t("inv.approvalPending")
        : inv.status === "rejected"
          ? t("inv.approvalRejected")
          : "—";

  const dateShort = new Date(inv.createdAt).toLocaleDateString(locale, { day: "numeric", month: "short" });

  const rowAccent = striped ? "co-inv-striped" : "";

  return (
    <Fragment>
      <tr
        className={`co-inv-main cursor-pointer outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40 ${rowAccent} ${expanded ? "co-table-row-active" : ""}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
      >
        <td className="co-inv-col-num tabular-nums text-[11px] text-slate-500 text-right align-middle">
          {index}
        </td>
        <td className="align-middle min-w-[10rem] max-w-[min(38vw,24rem)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <CompanyAvatar name={inv.accountName} size="sm" />
            <div className="min-w-0">
              <button
                type="button"
                className="text-sm font-medium text-slate-100 hover:text-indigo-300 transition-colors truncate block text-left w-full"
                onClick={(e) => { e.stopPropagation(); navigate(`/accounts/${inv.accountId}`); }}
              >
                {inv.accountName}
              </button>
              <p className="text-[11px] text-slate-500 truncate">
                {t(`inv.trigger.${inv.triggerReason}` as string) || inv.triggerReason}
              </p>
            </div>
          </div>
        </td>
        <td className="align-middle min-w-0 max-w-[min(28vw,16rem)]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-500 shrink-0"><ChannelIcon channel={inv.channel} /></span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-300 truncate">{channelLabel[inv.channel]}</p>
              <p className="text-[11px] text-slate-500 truncate">{inv.recipient}</p>
            </div>
          </div>
        </td>
        <td className="align-middle text-center whitespace-nowrap">
          <p className={`text-sm font-bold tabular-nums leading-tight ${confColor}`}>{conf}%</p>
          <p className="text-[10px] text-slate-500">{t("inv.confidenceLabel")}</p>
        </td>
        <td className="align-middle whitespace-nowrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${STATUS_STYLE[inv.status]}`}>
            {t(`inv.status.${inv.status}` as string)}
          </span>
        </td>
        <td className="align-middle whitespace-nowrap">
          {inv.outcome ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${OUTCOME_STYLE[inv.outcome]}`}>
              <span>{OUTCOME_ICON[inv.outcome]}</span>
              {t(`inv.outcome.${inv.outcome}` as string)}
            </span>
          ) : (
            <span className="text-[11px] text-slate-600">—</span>
          )}
        </td>
        <td className="align-middle text-right whitespace-nowrap text-[11px] text-slate-500 tabular-nums">
          {dateShort}
        </td>
        <td className="co-inv-col-chevron align-middle text-slate-500" aria-hidden>
          <svg
            {...SVG}
            className={`mx-auto block transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </td>
      </tr>

      <tr className={expanded ? "co-table-expand" : ""}>
        <td
          colSpan={INV_COL_COUNT}
          className={`!p-0 align-top ${expanded ? "" : "border-b-0 bg-transparent"}`}
        >
          <ExpandRowAccordion open={expanded}>
            <div className="border-t border-slate-800/50">
            <div className="px-5 pb-5 pt-4 grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                {inv.messageSubject && (
                  <>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{t("inv.expandSubject")}</p>
                    <p className="text-sm text-slate-200 font-medium">{inv.messageSubject}</p>
                  </>
                )}
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{t("inv.expandMessage")}</p>
                <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/40 rounded-xl p-3 border border-slate-800/80 shadow-inner">
                  {inv.messageBody}
                </p>
                {inv.outcomeNotes && (
                  <>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3">{t("inv.expandOutcomeNotes")}</p>
                    <p className="text-sm text-slate-400 leading-relaxed italic">{inv.outcomeNotes}</p>
                  </>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5">{t("inv.expandReasoning")}</p>
                  <p className="text-xs text-slate-400 leading-relaxed pl-3 border-l-2 border-indigo-500/45">
                    {inv.agentReasoning}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="bg-slate-950/35 rounded-xl p-2.5 border border-slate-800/70">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandApproval")}</p>
                    <p className="text-xs text-slate-200 mt-0.5 font-medium">{approvalLabel}</p>
                  </div>
                  <div className="bg-slate-950/35 rounded-xl p-2.5 border border-slate-800/70">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandConfidence")}</p>
                    <p className={`text-xs mt-0.5 font-bold tabular-nums ${confColor}`}>{conf}%</p>
                  </div>
                  {inv.sentAt && (
                    <div className="bg-slate-950/35 rounded-xl p-2.5 border border-slate-800/70">
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandSent")}</p>
                      <p className="text-xs text-slate-200 mt-0.5">
                        {new Date(inv.sentAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  )}
                  {inv.respondedAt && (
                    <div className="bg-slate-950/35 rounded-xl p-2.5 border border-slate-800/70">
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandResponded")}</p>
                      <p className="text-xs text-slate-200 mt-0.5">
                        {new Date(inv.respondedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  )}
                  {inv.rejectionReason && (
                    <div className="col-span-2 bg-rose-500/10 rounded-xl p-2.5 border border-rose-500/25">
                      <p className="text-[10px] text-rose-400 uppercase tracking-widest">{t("inv.expandRejection")}</p>
                      <p className="text-xs text-rose-300 mt-0.5">{inv.rejectionReason}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          </ExpandRowAccordion>
        </td>
      </tr>
    </Fragment>
  );
}

type FilterStatus = "all" | "pending_approval" | "active" | "resolved";

export default function Interventions() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const locale = lang === "es" ? "es" : "en-US";
  const { interventions, stats, loading, error } = useInterventions();

  const filtered = useMemo(() => {
    let list = [...interventions];
    if (filterChannel !== "all") list = list.filter((i) => i.channel === filterChannel);
    if (filterStatus === "pending_approval") list = list.filter((i) => i.status === "pending_approval");
    if (filterStatus === "active") list = list.filter((i) => ["sent", "delivered", "opened", "pending"].includes(i.status));
    if (filterStatus === "resolved") list = list.filter((i) => ["responded", "failed", "rejected"].includes(i.status) || i.outcome !== null);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [interventions, filterStatus, filterChannel]);

  const filtersDirty = filterStatus !== "all" || filterChannel !== "all";

  const resetFilters = () => {
    setFilterStatus("all");
    setFilterChannel("all");
    setExpandedId(null);
  };

  const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
    { label: t("inv.filterAll"),     value: "all" },
    { label: t("inv.filterPending"), value: "pending_approval" },
    { label: t("inv.filterActive"),  value: "active" },
    { label: t("inv.filterResolved"), value: "resolved" },
  ];

  const CHANNELS = ["all", "email", "slack", "whatsapp", "voice_call"] as const;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="relative -mx-2 px-2 pt-1">
        <div className="co-dash-hero" aria-hidden />
        <div className="co-dash-hero-wrap space-y-4">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <svg {...SVG} width="12" height="12" className="text-indigo-400">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
                </svg>
                <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300/90">{t("inv.badge")}</span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">{t("inv.title")}</h1>
              <p className="text-sm text-slate-400 mt-1">{t("inv.subtitle")}</p>
            </div>
          </div>

          {stats.total > 0 && (
            <p className="text-sm text-slate-400 max-w-3xl leading-relaxed border border-slate-800/80 rounded-xl px-4 py-3 bg-slate-900/40">
              <span className="text-indigo-300/90 font-medium">
                {t("inv.insightLine", {
                  pending: stats.pending,
                  rate: stats.successRate.toFixed(0),
                  success: stats.success,
                })}
              </span>
            </p>
          )}
        </div>
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.06 } },
        }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          <StatCard label={t("inv.statTotal")} value={stats.total} accent="text-slate-100" sub={t("inv.statTotalSub")} tone="neutral" motionIndex={0} icon={statIcons.total} />
        </motion.div>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          <StatCard label={t("inv.statPending")} value={stats.pending} accent="text-amber-400" sub={t("inv.statPendingSub")} tone="amber" motionIndex={1} icon={statIcons.pending} />
        </motion.div>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          <StatCard label={t("inv.statSuccess")} value={stats.success} accent="text-emerald-400" sub={t("inv.statSuccessSub")} tone="emerald" motionIndex={2} icon={statIcons.success} />
        </motion.div>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          <StatCard label={t("inv.statRate")} value={stats.successRate} suffix="%" accent="text-sky-400" sub={t("inv.statRateSub")} tone="sky" motionIndex={3} icon={statIcons.rate} />
        </motion.div>
      </motion.div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterPillGroup
            layoutId="co-pill-inv-status"
            value={filterStatus}
            onChange={(v) => { setFilterStatus(v); setExpandedId(null); }}
            options={STATUS_FILTERS.map((f) => ({
              value: f.value,
              label: f.label,
              suffix:
                f.value === "pending_approval" && stats.pending > 0 ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 tabular-nums transition-colors duration-200">
                    {stats.pending}
                  </span>
                ) : undefined,
            }))}
          />

          {filtersDirty && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-indigo-300/90 hover:text-indigo-200 border border-indigo-500/25 hover:border-indigo-400/40 rounded-lg px-3 py-2 bg-indigo-950/20 transition-colors"
            >
              {t("inv.resetFilters")}
            </button>
          )}
        </div>

        <FilterPillGroup
          layoutId="co-pill-inv-channel"
          value={filterChannel}
          onChange={(v) => { setFilterChannel(v); setExpandedId(null); }}
          size="sm"
          options={CHANNELS.map((ch) => ({
            value: ch,
            label:
              ch === "all" ? (
                t("inv.channelAll")
              ) : (
                <>
                  <span
                    className={`transition-colors duration-200 ${filterChannel === ch ? "text-indigo-300" : "text-slate-500"}`}
                  >
                    <ChannelIcon channel={ch} />
                  </span>
                  {channelLabel[ch]}
                </>
              ),
          }))}
        />
      </div>

      <SurfaceCard weight="panel" tone="neutral" hoverLift={false} motionIndex={4} surface="data" className="overflow-hidden">
        <div className="co-table-wrap">
          <div className="co-table-shell">
            <table className="co-table text-sm co-inv-table">
              <thead>
                <tr>
                  <th className="co-inv-col-num text-[11px] font-semibold text-slate-500 tabular-nums text-right normal-case tracking-normal">
                    {t("dash.colIndex")}
                  </th>
                  <th>{t("inv.colAccount")}</th>
                  <th>{t("inv.colChannel")}</th>
                  <th className="text-center">{t("inv.colConfidence")}</th>
                  <th>{t("inv.colStatus")}</th>
                  <th>{t("inv.colOutcome")}</th>
                  <th className="text-right">{t("inv.colDate")}</th>
                  <th className="co-inv-col-chevron p-0" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={INV_COL_COUNT} className="py-16 text-center align-middle">
                      <div className="w-8 h-8 mx-auto mb-3 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin" />
                      <p className="text-slate-400 text-sm">{t("global.loading")}</p>
                    </td>
                  </tr>
                ) : null}

                {!loading && error ? (
                  <tr>
                    <td colSpan={INV_COL_COUNT} className="py-16 text-center align-middle">
                      <p className="text-rose-400 text-sm mb-1">Error: {error}</p>
                    </td>
                  </tr>
                ) : null}

                {!loading && !error && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={INV_COL_COUNT} className="py-16 text-center align-middle">
                      <p className="text-slate-400 text-sm mb-1">{t("inv.empty")}</p>
                      <p className="text-xs text-slate-500 mb-6">{t("global.tryFilter")}</p>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {filtersDirty && (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="inline-flex items-center justify-center rounded-lg border border-indigo-500/35 bg-indigo-950/40 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900/50 transition-colors"
                          >
                            {t("inv.emptyReset")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate("/")}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
                        >
                          {t("inv.emptyGoDashboard")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {!loading && !error &&
                  filtered.map((inv, idx) => (
                    <InterventionRow
                      key={inv.id}
                      inv={inv}
                      index={idx + 1}
                      striped={idx % 2 === 1}
                      expanded={expandedId === inv.id}
                      onToggle={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                      locale={locale}
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
