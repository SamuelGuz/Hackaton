import { useEffect, useMemo, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";

type VoiceSessionState =
  | "awaiting_token"
  | "requesting_mic"
  | "connecting"
  | "live"
  | "ended"
  | "error";

interface Props {
  signedUrl: string;
  interventionId: string;
  triggerReason: string;
  messageBody: string;
  championName: string;
  companyName: string;
  csmName?: string;
  onClose: () => void;
}

type ConversationLike = {
  endSession: () => Promise<void>;
  setMicMuted: (muted: boolean) => void;
  getId?: () => string;
};

export function VoiceCallPanel({
  signedUrl,
  interventionId,
  triggerReason,
  messageBody,
  championName,
  companyName,
  csmName = "CSM",
  onClose,
}: Props) {
  const conversationRef = useRef<ConversationLike | null>(null);
  const [status, setStatus] = useState<VoiceSessionState>("awaiting_token");
  const [mode, setMode] = useState("listening");
  const [isMuted, setIsMuted] = useState(false);
  const [conversationId, setConversationId] = useState<string>(interventionId);
  const [lastEvent, setLastEvent] = useState("Esperando inicio de sesion...");

  useEffect(() => {
    let cancelled = false;
    const startTimer = window.setTimeout(() => {
      startConversation();
    }, 750);

    async function startConversation() {
      if (!signedUrl) {
        setStatus("error");
        setLastEvent("No se recibio URL firmada para la sesion.");
        return;
      }

      try {
        setStatus("requesting_mic");
        setLastEvent("Solicitando permiso de microfono...");
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setStatus("error");
        setLastEvent("Permiso de microfono denegado.");
        return;
      }

      try {
        setStatus("connecting");
        setLastEvent("Conectando llamada con ElevenLabs...");
        const sessionOptions: any = {
          signedUrl,
          connectionType: "websocket",
          dynamicVariables: {
            trigger_reason_label: triggerReason || "churn_risk_high",
            top_signals_text: "Caida de logins y tickets sin resolver",
            predicted_churn_reason: "adoption_drop_unresolved_tickets",
            message_body: messageBody || "",
            nombre_persona: championName || "cliente",
            empresa: companyName || "empresa",
            csm_name: csmName,
            champion_name: championName || "cliente",
          },
          onConnect: () => {
            setStatus("live");
            setLastEvent("Llamada activa. Habla normalmente.");
          },
          onDisconnect: () => {
            setStatus((prev) => (prev === "error" ? "error" : "ended"));
            setLastEvent("Llamada finalizada.");
          },
          onModeChange: (modeChange: unknown) => {
            if (typeof modeChange === "string") {
              setMode(modeChange);
              return;
            }
            if (
              modeChange &&
              typeof modeChange === "object" &&
              "mode" in modeChange &&
              typeof (modeChange as { mode?: unknown }).mode === "string"
            ) {
              setMode((modeChange as { mode: string }).mode);
            }
          },
          onError: (error: unknown) => {
            setStatus("error");
            const msg = error instanceof Error ? error.message : "Error de conexion";
            setLastEvent(`Error: ${msg}`);
          },
          onMessage: () => {
            setStatus("live");
          },
        };

        const conversation = (await Conversation.startSession(
          sessionOptions
        )) as ConversationLike;

        if (cancelled) {
          await conversation.endSession();
          return;
        }

        conversationRef.current = conversation;
        if (typeof conversation.getId === "function") {
          const id = conversation.getId();
          if (id) setConversationId(id);
        }
      } catch (error) {
        setStatus("error");
        const msg =
          error instanceof Error ? error.message : "No fue posible iniciar la conversacion";
        setLastEvent(msg);
      }
    }

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      const c = conversationRef.current;
      conversationRef.current = null;
      if (c) {
        c.endSession().catch(() => {
          // ignore cleanup errors
        });
      }
    };
  }, [signedUrl]);

  const statusLabel = useMemo(() => {
    if (status === "awaiting_token") return "Esperando token";
    if (status === "requesting_mic") return "Pidiendo microfono";
    if (status === "connecting") return "Conectando";
    if (status === "live") return mode === "speaking" ? "Agente hablando" : "Escuchando";
    if (status === "ended") return "Finalizada";
    return "Error";
  }, [mode, status]);

  async function endCall() {
    const c = conversationRef.current;
    conversationRef.current = null;
    if (c) {
      await c.endSession().catch(() => {
        // ignore
      });
    }
    setStatus("ended");
    setLastEvent("Llamada finalizada por el usuario.");
    onClose();
  }

  function toggleMute() {
    const c = conversationRef.current;
    if (!c) return;
    const next = !isMuted;
    c.setMicMuted(next);
    setIsMuted(next);
  }

  return (
    <section className="rounded-xl border border-indigo-500/30 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">
            Llamada ConvAI
          </p>
          <p className="text-xs text-slate-400 mt-1 break-all">Conversation: {conversationId}</p>
        </div>
        <span className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-200">
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-400">{lastEvent}</p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={toggleMute}
          disabled={status !== "live"}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isMuted ? "Activar microfono" : "Silenciar microfono"}
        </button>
        <button
          type="button"
          onClick={endCall}
          className="px-3 py-1.5 text-xs rounded-lg border border-rose-500/50 text-rose-200 hover:bg-rose-500/15 transition-colors"
        >
          Colgar
        </button>
      </div>
    </section>
  );
}
