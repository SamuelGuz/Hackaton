import { useEffect, useMemo, useRef, useState } from "react";

type VoiceSessionState = "awaiting_token" | "connecting" | "live" | "ended" | "error";

interface Props {
  signedUrl: string;
  interventionId: string;
  onClose: () => void;
}

export function VoiceCallPanel({ signedUrl, interventionId, onClose }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<VoiceSessionState>("awaiting_token");
  const [lastEvent, setLastEvent] = useState("Inicializando sesion...");

  useEffect(() => {
    if (!signedUrl) {
      setStatus("error");
      setLastEvent("No se recibio URL firmada para la sesion.");
      return;
    }

    setStatus("connecting");
    setLastEvent("Conectando con ElevenLabs ConvAI...");

    try {
      const ws = new WebSocket(signedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("live");
        setLastEvent("Sesion activa. Puedes comenzar a hablar.");
      };

      ws.onmessage = () => {
        setStatus("live");
        setLastEvent("Recibiendo eventos de la conversacion en tiempo real.");
      };

      ws.onerror = () => {
        setStatus("error");
        setLastEvent("No fue posible conectar con la sesion.");
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === "error" ? "error" : "ended"));
        setLastEvent((prev) =>
          prev === "No fue posible conectar con la sesion."
            ? prev
            : "Sesion finalizada."
        );
      };
    } catch {
      setStatus("error");
      setLastEvent("Error al abrir el canal websocket.");
    }

    return () => {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "ui_closed");
      }
    };
  }, [signedUrl]);

  const statusLabel = useMemo(() => {
    if (status === "awaiting_token") return "Esperando token";
    if (status === "connecting") return "Conectando";
    if (status === "live") return "En llamada";
    if (status === "ended") return "Finalizada";
    return "Error";
  }, [status]);

  return (
    <section className="rounded-xl border border-indigo-500/30 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">
            Voice Call ConvAI
          </p>
          <p className="text-sm text-slate-200 mt-1">Intervention: {interventionId}</p>
        </div>
        <span className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-200">
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-400">{lastEvent}</p>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors"
        >
          Cerrar panel
        </button>
      </div>
    </section>
  );
}
