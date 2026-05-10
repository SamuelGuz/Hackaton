import { motion } from "framer-motion";
import { useI18n } from "../context/I18nContext";
import { RiskBadge } from "./RiskBadge";
import { SkeletonRow } from "./Skeleton";
import { HealthHistoryCharts } from "./HealthHistoryCharts";
import type { AccountHealthHistoryItem } from "../types";

const SVG = {
  width: 12,
  height: 12,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relative(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return t("timeline.today");
  if (days === 1) return t("timeline.yesterday");
  if (days < 7) return t("timeline.daysAgo").replace("{n}", String(days));
  if (days < 30) return t("timeline.weeksAgo").replace("{n}", String(Math.floor(days / 7)));
  if (days < 365) return t("timeline.monthsAgo").replace("{n}", String(Math.floor(days / 30)));
  return t("timeline.yearsAgo").replace("{n}", String(Math.floor(days / 365)));
}

function DeltaPill({ delta, invert = false }: { delta: number; invert?: boolean }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 tabular-nums">
        <svg {...SVG} width="10" height="10"><line x1="5" y1="12" x2="19" y2="12" /></svg>0
      </span>
    );
  }
  const isUp = delta > 0;
  // For churn risk: up is bad. For expansion: up is good. `invert=true` means up is bad.
  const isBad = invert ? isUp : !isUp;
  const cls = isBad
    ? "text-rose-300 bg-rose-500/10 border-rose-500/25"
    : "text-emerald-300 bg-emerald-500/10 border-emerald-500/25";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border ${cls}`}>
      <svg {...SVG} width="10" height="10">
        {isUp ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
      </svg>
      {isUp ? "+" : ""}{delta}
    </span>
  );
}

function ScoreCell({ value, accent }: { value: number; accent: "rose" | "sky" }) {
  const barColor = accent === "rose" ? "bg-rose-400/80" : "bg-sky-400/80";
  const textColor = accent === "rose" ? "text-rose-200" : "text-sky-200";
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <span className={`text-sm font-semibold tabular-nums ${textColor} w-7 text-right`}>{value}</span>
      <div className="flex-1 h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full ${barColor} rounded-full`}
        />
      </div>
    </div>
  );
}

function ConfidenceCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-600 text-xs">—</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400/80" />
      {pct}%
    </span>
  );
}

export function HealthHistoryTable({
  items,
  loading,
  error,
}: {
  items: AccountHealthHistoryItem[];
  loading: boolean;
  error: string | null;
}) {
  const { t } = useI18n();


  if (error) {
    return (
      <div className="text-center text-rose-400 text-sm py-12">{error}</div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="text-center text-slate-500 text-sm py-12">
        {t("history.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Gráficas grandes */}
      {!loading && items.length >= 2 && (
        <HealthHistoryCharts items={items} />
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800/80 bg-slate-900/40">
                <th className="px-4 py-2.5 font-semibold">{t("history.colDate")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("history.colStatus")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("history.colChurn")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("history.colExpansion")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("history.colConfidence")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("history.colVersion")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
                : items.map((item, i) => {
                    const prev = items[i + 1];
                    const churnDelta = prev ? item.churnRiskScore - prev.churnRiskScore : 0;
                    const expDelta = prev ? item.expansionScore - prev.expansionScore : 0;
                    return (
                      <motion.tr
                        key={item.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: Math.min(i, 12) * 0.03 }}
                        className="group hover:bg-slate-900/50 transition-colors"
                      >
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          <div className="text-sm text-slate-200 tabular-nums">
                            {formatDateTime(item.computedAt)}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {relative(item.computedAt, t)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <RiskBadge status={item.healthStatus} />
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <ScoreCell value={item.churnRiskScore} accent="rose" />
                            {prev && <DeltaPill delta={churnDelta} invert />}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <ScoreCell value={item.expansionScore} accent="sky" />
                            {prev && <DeltaPill delta={expDelta} />}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <ConfidenceCell value={item.crystalBallConfidence} />
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className="text-[11px] font-mono text-slate-500">
                            {item.computedByVersion || "—"}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
