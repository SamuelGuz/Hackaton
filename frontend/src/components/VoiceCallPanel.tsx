import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client";

type VoiceSessionState =
  | "dialing"
  | "in_progress"
  | "ended"
  | "error";

interface Props {
  callSid?: string;
  toPhone?: string;
  interventionId: string;
  championName: string;
  onClose: () => void;
}

export function VoiceCallPanel({
  callSid,
  toPhone,
  interventionId,
  championName,
  onClose,
}: Props) {
  const [status, setStatus] = useState<VoiceSessionState>("dialing");
  const [lastEvent, setLastEvent] = useState("Marcando llamada...");
  const [isHangingUp, setIsHangingUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const res = await apiFetch<{ status: string }>(
          `/dispatch-intervention/status/${interventionId}`
        );
        if (cancelled) return;
        const current = res.status;
        if (current === "failed") {
          setStatus("error");
          setLastEvent("La llamada fallo o no fue contestada.");
          return;
        }
        if (current === "delivered") {
          setStatus("in_progress");
          setLastEvent("Llamada en curso.");
          return;
        }
        if (current === "responded") {
          setStatus("ended");
          setLastEvent("Llamada finalizada.");
          return;
        }
        if (current === "sent" || current === "pending") {
          setStatus("dialing");
          setLastEvent("Marcando llamada...");
          return;
        }
        setStatus("ended");
        setLastEvent(`Estado final: ${current}`);
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : "Error de polling";
        setStatus("error");
        setLastEvent(`Error consultando estado: ${msg}`);
      }
    };

    pollStatus();
    const timer = window.setInterval(pollStatus, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    }
  }, [interventionId]);

  const statusLabel = useMemo(() => {
    if (status === "dialing") return "Marcando";
    if (status === "in_progress") return "En curso";
    if (status === "ended") return "Finalizada";
    return "Error";
  }, [status]);

  async function hangupCall() {
    if (!callSid) return;
    try {
      setIsHangingUp(true);
      await apiFetch("/dispatch-intervention/twilio/hangup", {
        method: "POST",
        body: JSON.stringify({ intervention_id: interventionId }),
      });
      setStatus("ended");
      setLastEvent("Llamada colgada por el CSM.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Error de hangup";
      setStatus("error");
      setLastEvent(`No se pudo colgar: ${msg}`);
    } finally {
      setIsHangingUp(false);
    }
  }

  return (
    <section className="rounded-xl border border-indigo-500/30 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">
            Llamada PSTN
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {championName} {toPhone ? `(${toPhone})` : ""}
          </p>
          {callSid ? (
            <p className="text-[11px] text-slate-500 mt-1 break-all">Call SID: {callSid}</p>
          ) : null}
        </div>
        <span className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-200">
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-400">{lastEvent}</p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors"
        >
          Cerrar
        </button>
        <button
          type="button"
          onClick={hangupCall}
          disabled={status !== "in_progress" || isHangingUp || !callSid}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isHangingUp ? "Colgando..." : "Colgar"}
        </button>
      </div>
    </section>
  );
}
