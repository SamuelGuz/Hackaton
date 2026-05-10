import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  Legend,
} from "recharts";
import { useI18n } from "../context/I18nContext";
import type { AccountHealthHistoryItem } from "../types";

/* ─── Helpers ────────────────────────────────────────────────── */

function fmtDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function fmtDayFull(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSameDay(a: string, b: Date) {
  const da = new Date(a);
  return (
    da.getFullYear() === b.getFullYear() &&
    da.getMonth() === b.getMonth() &&
    da.getDate() === b.getDate()
  );
}

/* ─── Custom Tooltip ─────────────────────────────────────────── */

function CustomTooltip({
  active,
  payload,
  label,
  todayLabel,
}: {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
  todayLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-slate-700/60 bg-[rgba(10,12,20,0.96)] shadow-2xl shadow-black/60 px-4 py-3 min-w-[160px] backdrop-blur-md"
    >
      <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
        {label}
        {label === todayLabel && (
          <span className="ml-1.5 text-indigo-300">· hoy</span>
        )}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-bold tabular-nums text-white">{p.value}</span>
        </div>
      ))}
    </motion.div>
  );
}

/* ─── Custom Legend ──────────────────────────────────────────── */

function CustomLegend({
  items,
}: {
  items: { name: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="flex items-center justify-center gap-6 mt-1">
      {items.map((it) => (
        <div key={it.name} className="flex items-center gap-2 text-xs text-slate-400">
          <span
            className="inline-block h-0.5 w-5 rounded-full"
            style={{
              background: it.color,
              borderTop: it.dashed ? `2px dashed ${it.color}` : undefined,
              height: it.dashed ? 0 : undefined,
            }}
          />
          {it.name}
        </div>
      ))}
    </div>
  );
}

/* ─── Stat Badge ─────────────────────────────────────────────── */

function StatBadge({
  label,
  value,
  delta,
  accent,
  invert = false,
}: {
  label: string;
  value: number;
  delta: number;
  accent: "rose" | "sky";
  invert?: boolean;
}) {
  const isGood = invert ? delta < 0 : delta > 0;
  const deltaColor =
    delta === 0
      ? "text-slate-500"
      : isGood
      ? "text-emerald-300"
      : "text-rose-300";
  const accentText = accent === "rose" ? "text-rose-200" : "text-sky-200";
  const accentBg =
    accent === "rose"
      ? "bg-rose-500/10 border-rose-500/20"
      : "bg-sky-500/10 border-sky-500/20";

  return (
    <div className={`rounded-xl border px-4 py-3 ${accentBg}`}>
      <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${accentText}`}>
          {value}
        </span>
        <span className="text-xs text-slate-500">/ 100</span>
        {delta !== 0 && (
          <span className={`text-[11px] font-semibold tabular-nums ${deltaColor}`}>
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Tab selector ───────────────────────────────────────────── */

type ChartView = "both" | "churn" | "expansion";

/* ─── Main component ─────────────────────────────────────────── */

export function HealthHistoryCharts({
  items,
}: {
  items: AccountHealthHistoryItem[];
}) {
  const { t } = useI18n();
  const [view, setView] = useState<ChartView>("both");
  const today = new Date();

  // Items vienen desc → invertimos para cronológico
  const data = useMemo(
    () =>
      [...items]
        .reverse()
        .map((item) => ({
          rawDate: item.computedAt,
          label: fmtDay(item.computedAt),
          labelFull: fmtDayFull(item.computedAt),
          churn: item.churnRiskScore,
          expansion: item.expansionScore,
          confidence: item.crystalBallConfidence != null
            ? Math.round(item.crystalBallConfidence * 100)
            : null,
          isToday: isSameDay(item.computedAt, today),
        })),
    [items]
  );

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];

  const churnDelta = latest && prev ? latest.churn - prev.churn : 0;
  const expansionDelta = latest && prev ? latest.expansion - prev.expansion : 0;

  const todayLabel = data.find((d) => d.isToday)?.label ?? "";

  const showChurn = view === "both" || view === "churn";
  const showExpansion = view === "both" || view === "expansion";

  const views: { id: ChartView; label: string }[] = [
    { id: "both", label: t("history.chartBoth") },
    { id: "churn", label: t("history.chartChurn") },
    { id: "expansion", label: t("history.chartExpansion") },
  ];

  if (data.length < 2) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-5"
    >
      {/* Stat badges + view selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          {latest && (
            <>
              <StatBadge
                label={t("history.trendChurn")}
                value={latest.churn}
                delta={churnDelta}
                accent="rose"
                invert
              />
              <StatBadge
                label={t("history.trendExpansion")}
                value={latest.expansion}
                delta={expansionDelta}
                accent="sky"
              />
            </>
          )}
        </div>

        {/* View tabs */}
        <div className="inline-flex p-0.5 bg-slate-900/70 border border-slate-800/80 rounded-lg">
          {views.map(({ id, label }) => {
            const isActive = view === id;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="chart-view-pill"
                    className="absolute inset-0 bg-slate-800/80 border border-slate-700/80 rounded-md"
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                  />
                )}
                <span className="relative z-[1]">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className="rounded-2xl border border-slate-800/60 bg-[rgba(8,10,18,0.7)] p-5 backdrop-blur-sm"
          style={{
            boxShadow: "0 0 0 1px rgba(99,102,241,0.06), 0 8px 40px -8px rgba(0,0,0,0.6)",
          }}
        >
          {/* Subtle gradient top strip */}
          <div
            className="pointer-events-none absolute left-5 right-5 top-0 h-px rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(99,102,241,0.5) 30%, rgba(168,85,247,0.5) 70%, transparent)",
            }}
          />

          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={data}
              margin={{ top: 16, right: 12, left: -8, bottom: 0 }}
            >
              <defs>
                {/* Churn gradient */}
                <linearGradient id="gradChurn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(251,113,133)" stopOpacity={0.22} />
                  <stop offset="75%" stopColor="rgb(251,113,133)" stopOpacity={0.03} />
                  <stop offset="100%" stopColor="rgb(251,113,133)" stopOpacity={0} />
                </linearGradient>
                {/* Expansion gradient */}
                <linearGradient id="gradExpansion" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(125,211,252)" stopOpacity={0.22} />
                  <stop offset="75%" stopColor="rgb(125,211,252)" stopOpacity={0.03} />
                  <stop offset="100%" stopColor="rgb(125,211,252)" stopOpacity={0} />
                </linearGradient>
                {/* Glow filter */}
                <filter id="glowRose" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="glowSky" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(51,65,85,0.2)"
                vertical={false}
              />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748b", fontFamily: "Inter, sans-serif" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />

              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#64748b", fontFamily: "Inter, sans-serif" }}
                axisLine={false}
                tickLine={false}
                ticks={[0, 25, 50, 75, 100]}
              />

              <Tooltip
                content={
                  <CustomTooltip todayLabel={todayLabel} />
                }
                cursor={{
                  stroke: "rgba(99,102,241,0.3)",
                  strokeWidth: 1,
                  strokeDasharray: "4 2",
                }}
              />

              {/* Today reference line */}
              {todayLabel && (
                <ReferenceLine
                  x={todayLabel}
                  stroke="rgba(99,102,241,0.5)"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  label={{
                    value: "hoy",
                    position: "top",
                    fontSize: 9,
                    fill: "rgba(165,180,252,0.8)",
                    fontWeight: 600,
                    fontFamily: "Inter, sans-serif",
                  }}
                />
              )}

              {/* Churn area */}
              {showChurn && (
                <Area
                  type="monotone"
                  dataKey="churn"
                  name={t("history.trendChurn")}
                  stroke="rgb(251,113,133)"
                  strokeWidth={2}
                  fill="url(#gradChurn)"
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: "rgb(251,113,133)",
                    stroke: "rgba(10,12,20,0.9)",
                    strokeWidth: 2,
                  }}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              )}

              {/* Expansion area */}
              {showExpansion && (
                <Area
                  type="monotone"
                  dataKey="expansion"
                  name={t("history.trendExpansion")}
                  stroke="rgb(125,211,252)"
                  strokeWidth={2}
                  fill="url(#gradExpansion)"
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: "rgb(125,211,252)",
                    stroke: "rgba(10,12,20,0.9)",
                    strokeWidth: 2,
                  }}
                  animationDuration={800}
                  animationEasing="ease-out"
                  animationBegin={100}
                />
              )}

              {/* Today dot — churn */}
              {todayLabel && showChurn && latest?.isToday && (
                <ReferenceDot
                  x={todayLabel}
                  y={latest.churn}
                  r={5}
                  fill="rgb(251,113,133)"
                  stroke="rgba(10,12,20,0.9)"
                  strokeWidth={2}
                />
              )}

              {/* Today dot — expansion */}
              {todayLabel && showExpansion && latest?.isToday && (
                <ReferenceDot
                  x={todayLabel}
                  y={latest.expansion}
                  r={5}
                  fill="rgb(125,211,252)"
                  stroke="rgba(10,12,20,0.9)"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>

          {/* Legend */}
          <CustomLegend
            items={[
              ...(showChurn
                ? [{ name: t("history.trendChurn"), color: "rgb(251,113,133)" }]
                : []),
              ...(showExpansion
                ? [{ name: t("history.trendExpansion"), color: "rgb(125,211,252)" }]
                : []),
              { name: "Hoy", color: "rgba(99,102,241,0.6)", dashed: true },
            ]}
          />

          {/* Bottom note */}
          <p className="text-center text-[10px] text-slate-600 mt-3">
            {data.length} {t("history.snapshots")} · {t("history.chartDateAxis")}
          </p>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
