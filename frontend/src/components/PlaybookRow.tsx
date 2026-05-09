import { ChannelIcon, channelLabel } from "./ChannelIcon";
import { humanize } from "../utils/format";
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
  const entries = Object.entries(profile);
  if (entries.length === 0) return <span className="text-slate-500 text-xs">Sin filtros · aplica a todas las cuentas</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-slate-800/60 border border-slate-700/60 rounded px-2 py-1">
          <span className="text-slate-500">{humanize(k)}:</span>
          <span className="text-slate-200 font-medium">
            {Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "sí" : "no") : String(v)}
          </span>
        </span>
      ))}
    </div>
  );
}

interface Props {
  playbook: Playbook;
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

export function PlaybookRow({ playbook, expanded, onToggle, onJumpTo, byId }: Props) {
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
        className={`border-b border-slate-800/50 cursor-pointer focus:outline-none transition-colors ${
          expanded ? "bg-slate-800/40" : "hover:bg-slate-800/30 focus:bg-slate-800/30"
        } ${superseded && !expanded ? "opacity-60" : ""}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <svg
              {...SVG} width="12" height="12"
              className={`text-slate-500 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <div className="w-7 h-7 rounded-md bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
              <ChannelIcon channel={playbook.recommendedChannel} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">{playbook.name}</div>
              <div className="text-[11px] text-slate-500">
                {channelLabel[playbook.recommendedChannel]} · v{playbook.version}
                {superseded && <span className="ml-2 text-rose-400">· reemplazado</span>}
                {replaces   && <span className="ml-2 text-emerald-400">· reescritura</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-slate-400">
          {Object.entries(playbook.accountProfile).slice(0, 2).map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-slate-500">{k}:</span> {Array.isArray(v) ? v.join(", ") : String(v)}
            </div>
          ))}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-300 text-sm">{playbook.timesUsed}</td>
        <td className="px-4 py-3">
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

      {expanded && (
        <tr className="bg-slate-900/60">
          <td colSpan={4} className="px-4 pb-5 pt-1">
            <div className="ml-7 grid md:grid-cols-2 gap-5 pl-3 border-l-2 border-slate-700/60">
              {/* Left: profile + signal */}
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    Perfil de cuenta objetivo
                  </p>
                  <ProfileTags profile={playbook.accountProfile} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    Patrón de señales
                  </p>
                  <ProfileTags profile={playbook.signalPattern} />
                </div>
                <div className="flex gap-4 text-xs pt-1">
                  <div>
                    <span className="text-slate-500">Ejecuciones: </span>
                    <span className="text-slate-200 font-semibold tabular-nums">{playbook.timesUsed}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Éxitos: </span>
                    <span className="text-emerald-300 font-semibold tabular-nums">{playbook.timesSucceeded}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Fallas: </span>
                    <span className="text-rose-300 font-semibold tabular-nums">{playbook.timesUsed - playbook.timesSucceeded}</span>
                  </div>
                </div>

                {/* Supersede info */}
                {superseded && replacement && (
                  <div className="px-3 py-2 bg-rose-500/5 border border-rose-500/20 rounded-md text-xs">
                    <p className="text-rose-300 font-semibold mb-1">Este playbook fue reemplazado</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onJumpTo?.(replacement.id); }}
                      className="text-slate-300 hover:text-white inline-flex items-center gap-1 group"
                    >
                      Ver reemplazo: <span className="text-emerald-300 underline decoration-emerald-500/40 underline-offset-2 group-hover:decoration-emerald-400">{replacement.name}</span>
                      <svg {...SVG} width="11" height="11"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </button>
                  </div>
                )}
                {replaces && predecessor && (
                  <div className="px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md text-xs">
                    <p className="text-emerald-300 font-semibold mb-1">Reescritura del agente</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onJumpTo?.(predecessor.id); }}
                      className="text-slate-300 hover:text-white inline-flex items-center gap-1 group"
                    >
                      Versión anterior: <span className="text-rose-300 line-through decoration-rose-500/40 group-hover:decoration-rose-400">{predecessor.name}</span>
                      <svg {...SVG} width="11" height="11"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Right: message template */}
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  Plantilla de mensaje
                </p>
                <blockquote className="text-xs text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-700/60 rounded-md px-3 py-2.5 italic">
                  "{playbook.messageTemplate}"
                </blockquote>
                <p className="text-[10px] text-slate-500 mt-2">
                  Canal: <span className="text-slate-300">{channelLabel[playbook.recommendedChannel]}</span> · El agente personaliza variables por cuenta antes de lanzar.
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
