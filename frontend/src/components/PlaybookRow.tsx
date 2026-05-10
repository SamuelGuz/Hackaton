import { ChannelIcon } from "./ChannelIcon";
import { ExpandRowAccordion } from "./ExpandRowAccordion";
import { humanizeI18n } from "../utils/format";
import { useI18n } from "../context/I18nContext";
import type { Playbook } from "../types";

function rateColor(rate: number): string {
  if (rate >= 0.7) return "text-emerald-300";
  if (rate >= 0.5) return "text-amber-300";
  if (rate >= 0.35) return "text-orange-300";
  return "text-rose-300";
}

function rateBarColor(rate: number): string {
  if (rate >= 0.7) return "bg-emerald-400";
  if (rate >= 0.5) return "bg-amber-400";
  if (rate >= 0.35) return "bg-orange-400";
  return "bg-rose-400";
}

function ProfileTags({ profile }: { profile: Record<string, unknown> }) {
  const { t } = useI18n();
  const entries = Object.entries(profile);
  if (entries.length === 0) {
    return <span className="text-slate-500 text-xs">{t("cl.rowNoProfile")}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-slate-800/60 border border-slate-700/60 rounded px-2 py-1">
          <span className="text-slate-500">{humanizeI18n(k, t)}:</span>
          <span className="text-slate-200 font-medium">
            {Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}
          </span>
        </span>
      ))}
    </div>
  );
}

interface Props {
  playbook: Playbook;
  /** Posición 1-based dentro del listado actualmente filtrado/ordenado. */
  index?: number;
  expanded: boolean;
  onToggle: () => void;
  onJumpTo?: (id: string) => void;
  byId: Map<string, Playbook>;
}

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export function PlaybookRow({ playbook, index, expanded, onToggle, onJumpTo, byId }: Props) {
  const { t } = useI18n();
  const superseded = !!playbook.supersededBy;
  const replaces = !!playbook.supersedes;
  const ratePct = (playbook.successRate * 100).toFixed(0);

  const replacement = playbook.supersededBy ? byId.get(playbook.supersededBy) : null;
  const predecessor = playbook.supersedes  ? byId.get(playbook.supersedes)  : null;

  return (
    <>
      <tr
        id={`pb-row-${playbook.id}`}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className={`cursor-pointer focus:outline-none transition-opacity ${
          expanded ? "co-table-row-active" : ""
        } ${superseded && !expanded ? "opacity-60" : ""}`}
      >
        {index != null && (
          <td className="text-right tabular-nums text-[11px] text-slate-500 w-[2rem] min-w-[2rem] max-w-[2rem] px-1.5">{index}</td>
        )}
        <td>
          <div className="flex items-center gap-3">
            <svg {...SVG} width="12" height="12" className={`text-slate-500 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <div className="w-7 h-7 rounded-md bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
              <ChannelIcon channel={playbook.recommendedChannel} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">{playbook.name}</div>
              <div className="text-[11px] text-slate-500">
                {t(`channel.${playbook.recommendedChannel}` as any)} · v{playbook.version}
                {superseded && <span className="ml-2 text-rose-400">· {t("cl.rowReplaced")}</span>}
                {replaces   && <span className="ml-2 text-emerald-400">· {t("cl.rowRewrite")}</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="text-xs text-slate-400">
          {Object.entries(playbook.accountProfile).slice(0, 2).map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-slate-500">{k}:</span> {Array.isArray(v) ? v.join(", ") : String(v)}
            </div>
          ))}
        </td>
        <td className="text-right tabular-nums text-slate-300 text-sm">{playbook.timesUsed}</td>
        <td>
          <div className="flex items-center gap-2 justify-end">
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${rateBarColor(playbook.successRate)} rounded-full`} style={{ width: `${ratePct}%` }} />
            </div>
            <span className={`tabular-nums text-sm font-semibold w-10 text-right ${rateColor(playbook.successRate)}`}>
              {ratePct}%
            </span>
          </div>
        </td>
      </tr>

      <tr className={expanded ? "co-table-expand" : ""}>
        <td
          colSpan={index != null ? 5 : 4}
          className={`!p-0 align-top ${expanded ? "" : "border-b-0 bg-transparent"}`}
        >
          <ExpandRowAccordion open={expanded}>
            <div className="py-3 pb-5 ml-7 grid md:grid-cols-2 gap-5 pl-3 border-l-2 border-slate-700/60">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    {t("cl.rowProfile")}
                  </p>
                  <ProfileTags profile={playbook.accountProfile} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    {t("cl.rowSignal")}
                  </p>
                  <ProfileTags profile={playbook.signalPattern} />
                </div>
                <div className="flex gap-4 text-xs pt-1">
                  <div><span className="text-slate-500">{t("cl.rowRuns")}: </span><span className="text-slate-200 font-semibold tabular-nums">{playbook.timesUsed}</span></div>
                  <div><span className="text-slate-500">{t("cl.rowSuccesses")}: </span><span className="text-emerald-300 font-semibold tabular-nums">{playbook.timesSucceeded}</span></div>
                  <div><span className="text-slate-500">{t("cl.rowFails")}: </span><span className="text-rose-300 font-semibold tabular-nums">{playbook.timesUsed - playbook.timesSucceeded}</span></div>
                </div>

                {superseded && replacement && (
                  <div className="px-3 py-2 bg-rose-500/5 border border-rose-500/20 rounded-md text-xs">
                    <p className="text-rose-300 font-semibold mb-1">{t("cl.rowSuperseded")}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onJumpTo?.(replacement.id); }}
                      className="text-slate-300 hover:text-white inline-flex items-center gap-1 group"
                    >
                      {t("cl.rowViewReplacement")} <span className="text-emerald-300 underline decoration-emerald-500/40 underline-offset-2 group-hover:decoration-emerald-400">{replacement.name}</span>
                      <svg {...SVG} width="11" height="11"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </button>
                  </div>
                )}
                {replaces && predecessor && (
                  <div className="px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md text-xs">
                    <p className="text-emerald-300 font-semibold mb-1">{t("cl.rowRewriteOf")}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onJumpTo?.(predecessor.id); }}
                      className="text-slate-300 hover:text-white inline-flex items-center gap-1 group"
                    >
                      {t("cl.rowPrevious")} <span className="text-rose-300 line-through group-hover:decoration-rose-400">{predecessor.name}</span>
                      <svg {...SVG} width="11" height="11"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                    </button>
                  </div>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  {t("cl.rowTemplate")}
                </p>
                <blockquote className="text-xs text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-700/60 rounded-md px-3 py-2.5 italic">
                  "{playbook.messageTemplate}"
                </blockquote>
                <p className="text-[10px] text-slate-500 mt-2">
                  {t("cl.rowChannel")}: <span className="text-slate-300">{t(`channel.${playbook.recommendedChannel}` as any)}</span> · {t("cl.rowPersonalize")}
                </p>
              </div>
            </div>
          </ExpandRowAccordion>
        </td>
      </tr>
    </>
  );
}
