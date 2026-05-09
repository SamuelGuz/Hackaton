import { useEffect, useState } from "react";
import { getIntervention } from "../api/agents";
import { dispatchIntervention } from "../api/dispatch";
import { ChannelIcon, channelLabel } from "./ChannelIcon";
import { useToast } from "./Toast";
import type { ChannelDelivery, InterventionChannel, InterventionRecommendation } from "../types";

type Phase = "loading" | "ready" | "dispatching" | "done" | "error";

const ALL_CHANNELS: InterventionChannel[] = ["email", "slack", "whatsapp", "voice_call"];

function StatusDot({ status }: { status: ChannelDelivery["status"] | "queued" }) {
  if (status === "delivered") {
    return (
      <span className="w-5 h-5 rounded-full bg-emerald-500/20 ring-2 ring-emerald-500/60 flex items-center justify-center shrink-0">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (status === "sent" || status === "pending") {
    return (
      <span className="w-5 h-5 rounded-full border-2 border-indigo-400/60 border-t-indigo-300 animate-spin shrink-0" />
    );
  }
  if (status === "failed") {
    return (
      <span className="w-5 h-5 rounded-full bg-rose-500/20 ring-2 ring-rose-500/60 flex items-center justify-center shrink-0 text-rose-300 text-xs font-bold">!</span>
    );
  }
  return <span className="w-5 h-5 rounded-full border-2 border-slate-700 shrink-0" />;
}

interface Props {
  accountId: string;
  accountName: string;
  championName: string;
  championEmail: string;
  onClose: () => void;
}

export function InterventionModal({ accountId, accountName, championName, championEmail, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rec, setRec] = useState<InterventionRecommendation | null>(null);
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState("");
  const [deliveries, setDeliveries] = useState<ChannelDelivery[]>(
    ALL_CHANNELS.map((channel) => ({ channel, status: "pending" }))
  );
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getIntervention(accountId)
      .then((r) => {
        if (cancelled) return;
        setRec(r);
        setMessage(r.messageBody);
        setRecipient(r.recipient);
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
        toast.push("No se pudo cargar la recomendación", "error");
      });
    return () => { cancelled = true; };
  }, [accountId, toast]);

  // ESC para cerrar (solo si no está en mitad del dispatch)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "dispatching") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, onClose]);

  async function launch() {
    if (!rec) return;
    setPhase("dispatching");
    setDeliveries(ALL_CHANNELS.map((channel) => ({ channel, status: "pending" })));
    try {
      await dispatchIntervention(
        {
          channel: rec.recommendedChannel,
          recipient,
          messageBody: message,
        },
        (next) => setDeliveries(next)
      );
      setPhase("done");
      toast.push("4 canales entregados con éxito", "success");
    } catch (e) {
      setPhase("error");
      toast.push("Error al lanzar la intervención", "error");
    }
  }

  const recommendedSet = new Set<InterventionChannel>([rec?.recommendedChannel ?? "email"]);
  const allDelivered = phase === "done" && deliveries.every((d) => d.status === "delivered");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-in"
      onClick={() => phase !== "dispatching" && onClose()}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-0.5">
              Intervención · {accountName}
            </p>
            <h2 className="text-lg font-semibold text-white">
              {phase === "done" ? "Entregado en vivo" : "Lanzar acción multi-canal"}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={phase === "dispatching"}
            className="text-slate-500 hover:text-white p-1 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Cerrar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        {phase === "loading" && (
          <div className="p-12 text-center text-slate-400">
            <div className="w-8 h-8 mx-auto mb-3 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />
            <p className="text-sm">Generando recomendación con el agente...</p>
          </div>
        )}

        {phase === "error" && (
          <div className="p-12 text-center text-rose-400 text-sm">
            No se pudo generar la intervención.
          </div>
        )}

        {(phase === "ready" || phase === "dispatching" || phase === "done") && rec && (
          <>
            {/* Razonamiento del agente */}
            <div className="mx-6 mt-5 p-3.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-300"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300">
                  Decisión del agente
                </span>
                <span className="ml-auto text-[10px] text-slate-500">
                  Playbook con {(rec.playbookSuccessRateAtDecision * 100).toFixed(0)}% éxito · confianza {(rec.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{rec.agentReasoning}</p>
            </div>

            {/* Selector de canal */}
            <div className="px-6 pt-5">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                Canal recomendado
              </label>
              <div className="grid grid-cols-4 gap-2">
                {ALL_CHANNELS.map((ch) => {
                  const isRecommended = recommendedSet.has(ch);
                  return (
                    <div
                      key={ch}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs font-medium transition-colors ${
                        isRecommended
                          ? "bg-indigo-500/10 border-indigo-500/50 text-indigo-200"
                          : "bg-slate-800/40 border-slate-800 text-slate-500"
                      }`}
                    >
                      <ChannelIcon channel={ch} />
                      <span>{channelLabel[ch]}</span>
                      {isRecommended && (
                        <span className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">Sugerido</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recipient + champion */}
            <div className="px-6 pt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  Destinatario
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  disabled={phase !== "ready"}
                  className="w-full bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  Champion
                </label>
                <div className="bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-300 truncate">
                  {championName} <span className="text-slate-500">· {championEmail}</span>
                </div>
              </div>
            </div>

            {/* Mensaje editable */}
            <div className="px-6 pt-4 pb-2">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                Mensaje · script de la llamada
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={phase !== "ready"}
                rows={5}
                className="w-full bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2.5 text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500/60 disabled:opacity-60 resize-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Editá libremente antes de lanzar. ElevenLabs convierte a voz clonada.
              </p>
            </div>

            {/* Status de canales (solo durante/después del dispatch) */}
            {(phase === "dispatching" || phase === "done") && (
              <div className="px-6 pt-2 pb-2">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                  Estado de entrega en vivo
                </label>
                <div className="space-y-2">
                  {deliveries.map((d) => (
                    <div
                      key={d.channel}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                        d.status === "delivered"
                          ? "bg-emerald-500/5 border-emerald-500/30"
                          : "bg-slate-800/30 border-slate-800"
                      }`}
                    >
                      <StatusDot status={d.status} />
                      <span className="text-slate-300 shrink-0"><ChannelIcon channel={d.channel} /></span>
                      <span className="text-sm font-medium text-slate-200 flex-1">
                        {channelLabel[d.channel]}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          d.status === "delivered" ? "text-emerald-300" :
                          d.status === "failed"    ? "text-rose-300" :
                          d.status === "sent"      ? "text-indigo-300" :
                          "text-slate-500"
                        }`}
                      >
                        {d.status === "delivered" ? "Entregado" :
                         d.status === "sent"      ? "Enviando..." :
                         d.status === "failed"    ? "Falló" : "En cola"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-3 mt-4">
              <button
                onClick={onClose}
                disabled={phase === "dispatching"}
                className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
              >
                {allDelivered ? "Cerrar" : "Cancelar"}
              </button>

              {phase === "ready" && (
                <button
                  onClick={launch}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-br from-rose-500 to-orange-500 text-white text-sm font-semibold rounded-md shadow-lg shadow-rose-500/20 hover:from-rose-400 hover:to-orange-400 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Lanzar intervención multi-canal
                </button>
              )}

              {phase === "dispatching" && (
                <span className="text-sm font-medium text-indigo-300 flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin" />
                  Entregando en {ALL_CHANNELS.length} canales...
                </span>
              )}

              {phase === "done" && (
                <span className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  4 canales entregados
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
