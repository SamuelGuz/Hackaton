import { useI18n } from "../context/I18nContext";
import type { TimelineEvent } from "../types";

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

interface TypeStyle {
  ring: string;
  bg: string;
  icon: React.ReactNode;
  labelKey: string;
}

const styleByType = (type: TimelineEvent["type"], subtype: string): TypeStyle => {
  if (type === "ticket") {
    return {
      ring: "ring-rose-500/40",
      bg: "bg-rose-500/15 text-rose-300",
      icon: <svg {...SVG}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
      labelKey: "timeline.ticket",
    };
  }
  if (type === "conversation") {
    const labelKey = subtype === "call_transcript" ? "timeline.call"
      : subtype === "meeting_notes" ? "timeline.meeting"
      : "timeline.email";
    return {
      ring: "ring-violet-500/40",
      bg: "bg-violet-500/15 text-violet-300",
      icon: <svg {...SVG}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
      labelKey,
    };
  }
  if (subtype.includes("integration")) {
    return {
      ring: "ring-amber-500/40",
      bg: "bg-amber-500/15 text-amber-300",
      icon: <svg {...SVG}><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M9 6h6M6 9v6"/></svg>,
      labelKey: "timeline.integration",
    };
  }
  return {
    ring: "ring-sky-500/40",
    bg: "bg-sky-500/15 text-sky-300",
    icon: <svg {...SVG}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
    labelKey: "timeline.usage",
  };
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("es", {
    day: "numeric", month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function relative(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return t("timeline.today");
  if (days === 1) return t("timeline.yesterday");
  if (days < 7) return t("timeline.daysAgo").replace("{n}", String(days));
  if (days < 30) return t("timeline.weeksAgo").replace("{n}", String(Math.floor(days / 7)));
  if (days < 365) return t("timeline.monthsAgo").replace("{n}", String(Math.floor(days / 30)));
  return t("timeline.yearsAgo").replace("{n}", String(Math.floor(days / 365)));
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const { t } = useI18n();

  if (events.length === 0) {
    return (
      <div className="text-center text-slate-500 text-sm py-12">
        {t("detail.noEvents")}
      </div>
    );
  }

  return (
    <ol className="relative space-y-1">
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-800" aria-hidden />
      {events.map((event, i) => {
        const style = styleByType(event.type, event.subtype);
        return (
          <li key={i} className="relative flex gap-4 pl-0">
            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ring-2 ${style.ring} ${style.bg} shrink-0`}>
              {style.icon}
            </div>
            <div className="flex-1 min-w-0 pb-5">
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.bg} px-1.5 py-0.5 rounded`}>
                  {t(style.labelKey as any)}
                </span>
                <span className="text-[11px] text-slate-500">
                  {formatDate(event.timestamp)} · {relative(event.timestamp, t)}
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{event.summary}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
