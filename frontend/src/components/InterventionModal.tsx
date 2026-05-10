import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getIntervention } from "../api/agents";
import { dispatchInterventionMulti } from "../api/dispatch";
import { ChannelIcon } from "./ChannelIcon";
import { useToast } from "./Toast";
import { useI18n } from "../context/I18nContext";
import type {
  ChannelDelivery,
  ChannelDispatchInput,
  Champion,
  InterventionChannel,
  InterventionRecommendation,
} from "../types";

type Phase =
  | "loading"
  | "ready"
  | "dispatching"
  | "done"
  | "error"
  // Bloqueado porque ya hay otra intervención abierta para esta cuenta (HTTP 409 /
  // `open_intervention_exists`). El form NO se muestra: solo el mensaje de cool-off.
  | "cooloff";

const ALL_CHANNELS: InterventionChannel[] = ["email", "slack", "whatsapp", "voice_call"];
// Slack queda oculto del UI pero la funcionalidad sigue viva: el tipo, el dispatch,
// los recipients map y el ChannelIcon siguen aceptándolo. Si más adelante querés
// reactivarlo, basta con devolverlo a esta lista.
const VISIBLE_CHANNELS: InterventionChannel[] = ALL_CHANNELS.filter((c) => c !== "slack");

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
    return <span className="w-5 h-5 rounded-full border-2 border-indigo-400/60 border-t-indigo-300 animate-spin shrink-0" />;
  }
  if (status === "failed") {
    return <span className="w-5 h-5 rounded-full bg-rose-500/20 ring-2 ring-rose-500/60 flex items-center justify-center shrink-0 text-rose-300 text-xs font-bold">!</span>;
  }
  return <span className="w-5 h-5 rounded-full border-2 border-slate-700 shrink-0" />;
}

interface Props {
  accountId: string;
  accountName: string;
  champion: Pick<Champion, "name" | "email" | "phone" | "slackContact">;
  onClose: () => void;
  /** Llamado cuando la intervención se persiste con éxito o termina exitosamente, para que
   *  el padre refresque su lista (y el CTA pase a "Intervención en curso") sin recargar. */
  onLaunched?: () => void;
  /** voice_call: el backend devolvió callSid Twilio; el padre abre el VoiceCallPanel. */
  onVoiceSessionStart?: (payload: { interventionId: string; callSid?: string; toPhone?: string }) => void;
}

function defaultRecipient(channel: InterventionChannel, champion: Props["champion"]): string {
  if (channel === "email")      return champion.email && champion.email !== "—" ? champion.email : "";
  if (channel === "slack")      return champion.slackContact && champion.slackContact !== "—" ? champion.slackContact : "";
  if (channel === "whatsapp")   return champion.phone && champion.phone !== "—" ? champion.phone : "";
  if (channel === "voice_call") return champion.phone && champion.phone !== "—" ? champion.phone : "";
  return "";
}

/** Devuelve true si el champion no tiene contacto para el canal (campo vacío o "—"). */
function isChannelDisabled(channel: InterventionChannel, champion: Props["champion"]): boolean {
  return defaultRecipient(channel, champion).trim() === "";
}

function buildRecipientsMap(champion: Props["champion"]): Record<InterventionChannel, string> {
  return {
    email:      defaultRecipient("email", champion),
    slack:      defaultRecipient("slack", champion),
    whatsapp:   defaultRecipient("whatsapp", champion),
    voice_call: defaultRecipient("voice_call", champion),
  };
}

const panelEase = [0.22, 1, 0.36, 1] as const;

export function InterventionModal({
  accountId,
  accountName,
  champion,
  onClose,
  onLaunched,
  onVoiceSessionStart,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [rec, setRec] = useState<InterventionRecommendation | null>(null);
  const [cooloffMsg, setCooloffMsg] = useState("");
  const [message, setMessage] = useState("");
  // Multi-canal: el usuario tilda 1+ canales; se manda solo a los seleccionados.
  const [selectedChannels, setSelectedChannels] = useState<Set<InterventionChannel>>(new Set());
  // Recipient por canal (no un único campo). Default = contacto del champion.
  const [recipients, setRecipients] = useState<Record<InterventionChannel, string>>(() =>
    buildRecipientsMap(champion)
  );
  // `deliveries` solo trackea los canales seleccionados al lanzar (no los 4).
  const [deliveries, setDeliveries] = useState<ChannelDelivery[]>([]);
  const toast = useToast();

  useEffect(() => {
    // El backend serializa con un lock por account_id y devuelve la intervención
    // existente si ya hay una abierta — esto evita los duplicados que en
    // StrictMode generaba el doble mount aun cuando el AbortController cancelaba
    // el primer fetch en cliente.
    const controller = new AbortController();
    let launchNotified = false;

    async function load() {
      try {
        const r = await getIntervention(accountId, "churn_risk_high", controller.signal);
        // eslint-disable-next-line no-console
        console.debug("[InterventionModal] agent OK", {
          interventionId: r.interventionId,
          status: r.status,
          requiresApproval: r.requiresApproval,
          autoApproved: r.autoApproved,
        });
        setRec(r);
        setMessage(r.messageBody);
        // Pre-seleccionamos solo el canal recomendado, salvo que esté deshabilitado por
        // falta de contacto del champion (evita lanzar a un canal sin destinatario).
        // Slack está oculto del UI: si lo recomienda, no pre-seleccionamos nada para
        // forzar que el usuario elija explícitamente entre los canales visibles.
        if (
          r.recommendedChannel !== "slack" &&
          !isChannelDisabled(r.recommendedChannel, champion)
        ) {
          setSelectedChannels(new Set([r.recommendedChannel]));
        }
        // Si el backend devolvió un recipient específico para el canal recomendado, lo usamos.
        if (r.recipient) {
          setRecipients((prev) => ({ ...prev, [r.recommendedChannel]: r.recipient }));
        }
        // El backend ya persistió la intervención: el padre debe refrescar para mostrar
        // "intervención en curso" si el modal se cierra antes de despachar.
        if (!launchNotified) {
          launchNotified = true;
          onLaunched?.();
        }
        // Siempre vamos a "ready". Si requiresApproval=true mostramos un banner ámbar y el
        // click en "Lanzar" actúa como aprobación CSM (el endpoint /multi acepta
        // pending_approval). Esto reemplaza la fase awaiting_approval anterior.
        setPhase("ready");
      } catch (err) {
        const e = err as { status?: number; message?: string; name?: string } | null | undefined;
        // AbortError: cleanup de StrictMode canceló el fetch — silencioso.
        if (e?.name === "AbortError") return;
        const status = e?.status;
        // eslint-disable-next-line no-console
        console.debug("[InterventionModal] agent ERROR", { name: e?.name, status, message: e?.message });
        if (status === 409 || (e?.message ?? "").includes("status=pending_approval") || (e?.message ?? "").includes("last intervention") || (e?.message ?? "").includes("open_intervention_exists")) {
          setCooloffMsg(e?.message || t("modal.cooloffBody"));
          setPhase("cooloff");
          if (!launchNotified) {
            launchNotified = true;
            onLaunched?.();
          }
          return;
        }
        setPhase("error");
        toast.push(t("toast.recError"), "error");
      }
    }

    load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "dispatching") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, onClose]);

  async function launch() {
    if (!rec) return;
    if (!rec.interventionId) {
      toast.push(t("toast.interventionError"), "error");
      return;
    }
    const channelsToSend: InterventionChannel[] = Array.from(selectedChannels);
    if (channelsToSend.length === 0) {
      toast.push(t("modal.selectAtLeastOne"), "error");
      return;
    }
    const missingRecipient = channelsToSend.find((ch) => !(recipients[ch] ?? "").trim());
    if (missingRecipient) {
      toast.push(t("toast.interventionError"), "error");
      return;
    }

    const channelsPayload: ChannelDispatchInput[] = channelsToSend.map((channel) => {
      const recipient =
        channel === "voice_call"
          ? (champion.phone && champion.phone !== "—" ? champion.phone : recipients[channel])
          : recipients[channel];
      return {
        channel,
        recipient,
        messageSubject: rec.messageSubject ?? null,
      };
    });

    setPhase("dispatching");
    setDeliveries(channelsToSend.map((channel) => ({ channel, status: "pending" })));
    try {
      const result = await dispatchInterventionMulti(
        {
          interventionId: rec.interventionId,
          messageBody: message,
          channels: channelsPayload,
          accountId: rec.accountId,
          triggerReason: rec.triggerReason,
          confidence: rec.confidence,
          playbookId: rec.playbookIdUsed ?? undefined,
          playbookSuccessRate: rec.playbookSuccessRateAtDecision,
          agentReasoning: rec.agentReasoning,
          autoApproved: rec.autoApproved,
          approvalReasoning: rec.approvalReasoning,
          approvalStatus: rec.status,
        },
        (next) => setDeliveries(next)
      );
      // voice_call: si el backend devolvió callSid, abrimos panel PSTN.
      if (channelsToSend.includes("voice_call") && rec.interventionId) {
        onVoiceSessionStart?.({
          interventionId: rec.interventionId,
          callSid: result.callSid,
          toPhone: result.toPhone,
        });
      }
      setPhase("done");
      toast.push(t("toast.interventionOk"), "success");
    } catch (err) {
      setDeliveries([]);
      setPhase("ready");
      const e = err as { message?: string } | null | undefined;
      const msg = e?.message || t("toast.interventionError");
      toast.push(msg, "error");
    }
  }

  function toggleChannel(channel: InterventionChannel) {
    if (isChannelDisabled(channel, champion)) return;
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  // Habilitamos "Lanzar" si hay al menos un canal y todos sus recipients tienen valor.
  const launchEnabled = useMemo(() => {
    if (selectedChannels.size === 0) return false;
    for (const ch of selectedChannels) {
      if (!(recipients[ch] ?? "").trim()) return false;
    }
    return true;
  }, [selectedChannels, recipients]);

  const recommendedSet = new Set<InterventionChannel>([rec?.recommendedChannel ?? "email"]);
  const allDelivered = phase === "done" && deliveries.every((d) => d.status === "delivered");

  const statusLabel = (status: ChannelDelivery["status"]): string => {
    if (status === "delivered") return t("modal.statusDelivered");
    if (status === "sent")      return t("modal.statusSending");
    if (status === "failed")    return t("modal.statusFailed");
    return t("modal.statusQueued");
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => phase !== "dispatching" && onClose()}
    >
      <motion.div
        className="co-surface-tile-bg border border-slate-800/90 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] ring-1 ring-indigo-500/12"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.38, ease: panelEase }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 sc-card-noise opacity-[0.04] rounded-2xl" aria-hidden />

        <div className="relative z-[1]">
          <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-0.5">
                {t("modal.title", { name: accountName })}
              </p>
              <h2 className="text-lg font-semibold text-white tracking-tight">
                {phase === "done"
                  ? t("modal.titleDone")
                  : phase === "cooloff"
                    ? t("modal.titleCooloff")
                    : t("modal.titleReady")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={phase === "dispatching"}
              className="text-slate-500 hover:text-white p-2 rounded-lg hover:bg-slate-800/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <AnimatePresence mode="wait">
            {phase === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="p-14 text-center text-slate-400"
              >
                <motion.div
                  className="w-9 h-9 mx-auto mb-4 border-2 border-slate-700 border-t-indigo-400 rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
                />
                <p className="text-sm">{t("modal.generating")}</p>
              </motion.div>
            )}

            {phase === "error" && !rec && (
              <motion.div
                key="err-load"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-12 text-center text-rose-400 text-sm"
              >
                {t("modal.noRec")}
              </motion.div>
            )}

            {phase === "cooloff" && (
              <motion.div
                key="cooloff"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-8 text-center"
              >
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-300">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-amber-200 mb-2">
                  {t("modal.cooloffTitle")}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto mb-6">
                  {cooloffMsg || t("modal.cooloffBody")}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors"
                >
                  {t("modal.cooloffClose")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {(phase === "ready" || phase === "dispatching" || phase === "done") && rec && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: panelEase, delay: 0.04 }}
            >
              {rec.requiresApproval && (
                <div className="mx-6 mt-5 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-300 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <p className="text-[11px] text-amber-200 leading-relaxed">
                    {t("modal.approvalRequired")}
                  </p>
                </div>
              )}

              <div className="mx-6 mt-5 p-3.5 rounded-xl border border-indigo-500/22 bg-gradient-to-br from-indigo-500/[0.07] to-violet-600/[0.04] shadow-inner">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-300 shrink-0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300">
                    {t("modal.agentDecision")}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-500">
                    {t("modal.playbookStat", {
                      pct: (rec.playbookSuccessRateAtDecision * 100).toFixed(0),
                      conf: (rec.confidence * 100).toFixed(0),
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{rec.agentReasoning}</p>
              </div>

              <div className="px-6 pt-5">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                  {t("modal.channel")}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {VISIBLE_CHANNELS.map((ch) => {
                    const isRec = recommendedSet.has(ch);
                    const isSelected = selectedChannels.has(ch);
                    const isDisabled = isChannelDisabled(ch, champion);
                    const interactive = !isDisabled && phase !== "dispatching" && phase !== "done";
                    const channelLabel = t(`channel.${ch}` as string);
                    return (
                      <motion.button
                        key={ch}
                        type="button"
                        onClick={() => interactive && toggleChannel(ch)}
                        disabled={!interactive}
                        whileHover={interactive ? { y: -2 } : undefined}
                        transition={{ type: "spring", stiffness: 400, damping: 28 }}
                        title={isDisabled ? t("modal.channelMissingContact", { label: channelLabel }) : undefined}
                        aria-pressed={isSelected}
                        className={`relative flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/45 ${
                          isDisabled
                            ? "bg-slate-950/40 border-slate-800/60 text-slate-600 opacity-50 cursor-not-allowed"
                            : isSelected
                              ? "bg-indigo-500/15 border-indigo-500/55 text-indigo-100 shadow-[0_0_20px_-8px_rgba(99,102,241,0.45)] cursor-pointer"
                              : "bg-slate-950/40 border-slate-800/90 text-slate-400 hover:border-slate-700 hover:text-slate-200 cursor-pointer"
                        } ${!interactive && !isDisabled ? "opacity-70 cursor-not-allowed" : ""}`}
                      >
                        {isSelected && !isDisabled && (
                          <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                        <ChannelIcon channel={ch} />
                        <span>{channelLabel}</span>
                        {isRec && !isDisabled && (
                          <span className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">{t("modal.suggested")}</span>
                        )}
                        {isDisabled && (
                          <span className="text-[9px] text-slate-600 font-medium">{t("modal.channelMissingContact", { label: channelLabel })}</span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {selectedChannels.size > 0 && (
                <div className="px-6 pt-4 space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    {t("modal.recipient")}
                  </label>
                  <div className="space-y-2">
                    {VISIBLE_CHANNELS.filter((ch) => selectedChannels.has(ch)).map((ch) => {
                      const channelLabel = t(`channel.${ch}` as string);
                      return (
                        <div key={ch} className="flex items-center gap-2">
                          <span className="text-slate-500 shrink-0 w-5 flex justify-center">
                            <ChannelIcon channel={ch} />
                          </span>
                          <input
                            type="text"
                            value={recipients[ch] ?? ""}
                            onChange={(e) =>
                              setRecipients((prev) => ({ ...prev, [ch]: e.target.value }))
                            }
                            disabled={phase === "dispatching" || phase === "done"}
                            placeholder={t("modal.recipientFor", { label: channelLabel })}
                            className="flex-1 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/55 focus:ring-1 focus:ring-indigo-500/25 disabled:opacity-60 transition-shadow"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="px-6 pt-4 pb-1">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  {t("modal.message")}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={phase === "dispatching" || phase === "done"}
                  rows={5}
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500/55 focus:ring-1 focus:ring-indigo-500/25 disabled:opacity-60 resize-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t("modal.messageHint")}</p>
              </div>

              <AnimatePresence>
                {(phase === "dispatching" || phase === "done") && (
                  <motion.div
                    key="delivery"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.26, ease: panelEase }}
                    className="px-6 pt-2"
                  >
                    <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                      {t("modal.deliveryStatus")}
                    </label>
                    <div className="space-y-2 pb-2">
                      {deliveries.map((d, i) => (
                        <motion.div
                          key={d.channel}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05, duration: 0.22, ease: panelEase }}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${d.status === "delivered" ? "bg-emerald-500/[0.06] border-emerald-500/28" : "bg-slate-950/35 border-slate-800/80"}`}
                        >
                          <StatusDot status={d.status} />
                          <span className="text-slate-400 shrink-0"><ChannelIcon channel={d.channel} /></span>
                          <span className="text-sm font-medium text-slate-200 flex-1">{t(`channel.${d.channel}` as string)}</span>
                          <span className={`text-xs font-medium ${d.status === "delivered" ? "text-emerald-300" : d.status === "failed" ? "text-rose-300" : d.status === "sent" ? "text-indigo-300" : "text-slate-500"}`}>
                            {statusLabel(d.status)}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="px-6 py-4 border-t border-slate-800/80 flex items-center justify-between gap-3 mt-2 flex-wrap">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase === "dispatching"}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white disabled:opacity-30 transition-colors rounded-lg hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600/50"
                >
                  {allDelivered ? t("modal.close") : t("modal.cancel")}
                </button>

                {phase === "ready" && (
                  <motion.button
                    type="button"
                    onClick={launch}
                    disabled={!launchEnabled}
                    whileHover={launchEnabled ? { scale: 1.02 } : undefined}
                    whileTap={launchEnabled ? { scale: 0.98 } : undefined}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:via-indigo-500 hover:to-violet-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed disabled:from-slate-700 disabled:via-slate-700 disabled:to-slate-700 disabled:shadow-none"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {selectedChannels.size > 1
                      ? t("modal.launchMulti", { n: selectedChannels.size })
                      : t("modal.launch")}
                  </motion.button>
                )}

                {phase === "dispatching" && (
                  <span className="text-sm font-medium text-indigo-300 flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin" />
                    {t("modal.launching", { n: deliveries.length })}
                  </span>
                )}

                {phase === "done" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-sm font-semibold text-emerald-300 flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {t("modal.done")}
                  </motion.span>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
