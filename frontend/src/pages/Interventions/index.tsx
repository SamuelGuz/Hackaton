import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mockInterventions } from "../../mocks/interventions";
import { ChannelIcon, channelLabel } from "../../components/ChannelIcon";
import { CompanyAvatar } from "../../components/CompanyAvatar";
import { SurfaceCard } from "../../components/SurfaceCard";
import { useCountUp } from "../../hooks/useCountUp";
import { useI18n } from "../../context/I18nContext";
import type { Intervention, InterventionStatus, InterventionOutcome } from "../../types";

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

/* ─── Status badge styles ───────────────────────────────────────── */
const STATUS_STYLE: Record<InterventionStatus, string> = {
  pending_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rejected:         "bg-rose-900/40  text-rose-400  border-rose-700/40",
  pending:          "bg-slate-700/40 text-slate-300  border-slate-600/40",
  sent:             "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  delivered:        "bg-blue-500/15  text-blue-300   border-blue-500/30",
  opened:           "bg-sky-500/15   text-sky-300    border-sky-500/30",
  responded:        "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed:           "bg-rose-500/15  text-rose-300   border-rose-500/30",
};

/* ─── Outcome badge styles ──────────────────────────────────────── */
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

/* ─── Stat card ─────────────────────────────────────────────────── */
function StatCard({ label, value, suffix, accent, sub, tone, motionIndex }: {
  label: string; value: number; suffix?: string;
  accent: string; sub: string; tone: any; motionIndex: number;
}) {
  const animated = useCountUp(value, 900);
  return (
    <SurfaceCard tone={tone} motionIndex={motionIndex} className="p-4">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent}`}>
        {suffix === "%" ? animated.toFixed(0) : Math.round(animated)}
        <span className="text-base font-normal text-slate-500">{suffix}</span>
      </p>
      <p className="text-[11px] text-slate-500 mt-1 leading-snug">{sub}</p>
    </SurfaceCard>
  );
}

/* ─── Expandable row ─────────────────────────────────────────────── */
function InterventionRow({ inv, expanded, onToggle }: {
  inv: Intervention;
  expanded: boolean;
  onToggle: () => void;
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

  return (
    <div className={`border-b border-slate-800/60 last:border-0 transition-colors ${expanded ? "bg-slate-900/60" : "hover:bg-slate-900/30"}`}>
      {/* Main row */}
      <div
        className="grid items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
        style={{ gridTemplateColumns: "minmax(160px,1.8fr) minmax(110px,1fr) 90px 120px 110px 80px 28px" }}
        onClick={onToggle}
      >
        {/* Account */}
        <div className="flex items-center gap-2.5 min-w-0">
          <CompanyAvatar name={inv.accountName} size="sm" />
          <div className="min-w-0">
            <button
              className="text-sm font-medium text-slate-100 hover:text-indigo-300 transition-colors truncate block text-left"
              onClick={(e) => { e.stopPropagation(); navigate(`/accounts/${inv.accountId}`); }}
            >
              {inv.accountName}
            </button>
            <p className="text-[11px] text-slate-500 truncate">
              {t(`inv.trigger.${inv.triggerReason}` as any) || inv.triggerReason}
            </p>
          </div>
        </div>

        {/* Channel + recipient */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-slate-400 shrink-0"><ChannelIcon channel={inv.channel} /></span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-300">{channelLabel[inv.channel]}</p>
            <p className="text-[11px] text-slate-500 truncate">{inv.recipient}</p>
          </div>
        </div>

        {/* Confidence */}
        <div className="text-center">
          <p className={`text-sm font-bold tabular-nums ${confColor}`}>{conf}%</p>
          <p className="text-[10px] text-slate-500">{t("inv.confidenceLabel")}</p>
        </div>

        {/* Status */}
        <div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${STATUS_STYLE[inv.status]}`}>
            {t(`inv.status.${inv.status}` as any)}
          </span>
        </div>

        {/* Outcome */}
        <div>
          {inv.outcome ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${OUTCOME_STYLE[inv.outcome]}`}>
              <span>{OUTCOME_ICON[inv.outcome]}</span>
              {t(`inv.outcome.${inv.outcome}` as any)}
            </span>
          ) : (
            <span className="text-[11px] text-slate-600">—</span>
          )}
        </div>

        {/* Date */}
        <div className="text-[11px] text-slate-500 tabular-nums text-right">
          {new Date(inv.createdAt).toLocaleDateString("es", { day: "numeric", month: "short" })}
        </div>

        {/* Chevron */}
        <svg {...SVG} className={`text-slate-600 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 grid md:grid-cols-2 gap-4 border-t border-slate-800/50 pt-4">
          {/* Message */}
          <div className="space-y-2">
            {inv.messageSubject && (
              <>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{t("inv.expandSubject")}</p>
                <p className="text-sm text-slate-200 font-medium">{inv.messageSubject}</p>
              </>
            )}
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{t("inv.expandMessage")}</p>
            <p className="text-sm text-slate-300 leading-relaxed bg-slate-800/40 rounded-lg p-3 border border-slate-700/40">
              {inv.messageBody}
            </p>
            {inv.outcomeNotes && (
              <>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3">{t("inv.expandOutcomeNotes")}</p>
                <p className="text-sm text-slate-400 leading-relaxed italic">{inv.outcomeNotes}</p>
              </>
            )}
          </div>

          {/* Agent reasoning + meta */}
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5">{t("inv.expandReasoning")}</p>
              <p className="text-xs text-slate-400 leading-relaxed pl-3 border-l-2 border-indigo-500/40">
                {inv.agentReasoning}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandApproval")}</p>
                <p className="text-xs text-slate-200 mt-0.5 font-medium">{approvalLabel}</p>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandConfidence")}</p>
                <p className={`text-xs mt-0.5 font-bold tabular-nums ${confColor}`}>{conf}%</p>
              </div>
              {inv.sentAt && (
                <div className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/30">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandSent")}</p>
                  <p className="text-xs text-slate-200 mt-0.5">
                    {new Date(inv.sentAt).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              )}
              {inv.respondedAt && (
                <div className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/30">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t("inv.expandResponded")}</p>
                  <p className="text-xs text-slate-200 mt-0.5">
                    {new Date(inv.respondedAt).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              )}
              {inv.rejectionReason && (
                <div className="col-span-2 bg-rose-500/10 rounded-lg p-2.5 border border-rose-500/25">
                  <p className="text-[10px] text-rose-400 uppercase tracking-widest">{t("inv.expandRejection")}</p>
                  <p className="text-xs text-rose-300 mt-0.5">{inv.rejectionReason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */
type FilterStatus = "all" | "pending_approval" | "active" | "resolved";

export default function Interventions() {
  const { t } = useI18n();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const interventions = mockInterventions;

  const stats = useMemo(() => {
    const total = interventions.length;
    const success = interventions.filter((i) => i.outcome === "success").length;
    const pending = interventions.filter((i) => i.status === "pending_approval").length;
    const resolved = interventions.filter((i) => i.outcome !== null);
    const successRate = resolved.length > 0
      ? (resolved.filter((i) => i.outcome === "success" || i.outcome === "partial").length / resolved.length) * 100
      : 0;
    return { total, success, pending, successRate };
  }, [interventions]);

  const filtered = useMemo(() => {
    let list = [...interventions];
    if (filterChannel !== "all") list = list.filter((i) => i.channel === filterChannel);
    if (filterStatus === "pending_approval") list = list.filter((i) => i.status === "pending_approval");
    if (filterStatus === "active") list = list.filter((i) => ["sent", "delivered", "opened", "pending"].includes(i.status));
    if (filterStatus === "resolved") list = list.filter((i) => ["responded", "failed", "rejected"].includes(i.status) || i.outcome !== null);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [interventions, filterStatus, filterChannel]);

  const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
    { label: t("inv.filterAll"),     value: "all" },
    { label: t("inv.filterPending"), value: "pending_approval" },
    { label: t("inv.filterActive"),  value: "active" },
    { label: t("inv.filterResolved"),value: "resolved" },
  ];

  const CHANNELS = ["all", "email", "slack", "whatsapp", "voice_call"] as const;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <svg {...SVG} width="12" height="12" className="text-indigo-300">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
          </svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300">{t("inv.badge")}</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("inv.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("inv.subtitle")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t("inv.statTotal")}   value={stats.total}       accent="text-slate-100"   sub={t("inv.statTotalSub")}   tone="neutral" motionIndex={0} />
        <StatCard label={t("inv.statPending")} value={stats.pending}     accent="text-amber-300"   sub={t("inv.statPendingSub")} tone="amber"   motionIndex={1} />
        <StatCard label={t("inv.statSuccess")} value={stats.success}     accent="text-emerald-300" sub={t("inv.statSuccessSub")} tone="emerald" motionIndex={2} />
        <StatCard label={t("inv.statRate")}    value={stats.successRate} suffix="%" accent="text-sky-300" sub={t("inv.statRateSub")} tone="sky" motionIndex={3} />
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Status filter */}
        <div className="flex gap-1 bg-slate-900/70 border border-slate-800 rounded-lg p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterStatus(f.value)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${filterStatus === f.value ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
            >
              {f.label}
              {f.value === "pending_approval" && stats.pending > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 tabular-nums">{stats.pending}</span>
              )}
            </button>
          ))}
        </div>

        {/* Channel filter */}
        <div className="flex gap-1 bg-slate-900/70 border border-slate-800 rounded-lg p-1">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              onClick={() => setFilterChannel(ch)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filterChannel === ch ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
            >
              {ch === "all" ? (
                t("inv.channelAll")
              ) : (
                <>
                  <span className={filterChannel === ch ? "text-indigo-300" : "text-slate-500"}>
                    <ChannelIcon channel={ch} />
                  </span>
                  {channelLabel[ch]}
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <SurfaceCard weight="panel" tone="neutral" hoverLift={false} motionIndex={4} surface="data" className="overflow-hidden">
        {/* Header row */}
        <div
          className="grid gap-3 px-5 py-2.5 border-b border-slate-800 bg-slate-950/30"
          style={{ gridTemplateColumns: "minmax(160px,1.8fr) minmax(110px,1fr) 90px 120px 110px 80px 28px" }}
        >
          {[
            t("inv.colAccount"), t("inv.colChannel"), t("inv.colConfidence"),
            t("inv.colStatus"), t("inv.colOutcome"), t("inv.colDate"), "",
          ].map((h, i) => (
            <p key={i} className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">{h}</p>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">{t("inv.empty")}</p>
          </div>
        ) : (
          filtered.map((inv) => (
            <InterventionRow
              key={inv.id}
              inv={inv}
              expanded={expandedId === inv.id}
              onToggle={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
            />
          ))
        )}
      </SurfaceCard>
    </div>
  );
}
