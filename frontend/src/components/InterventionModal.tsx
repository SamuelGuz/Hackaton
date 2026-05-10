import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getIntervention } from "../api/agents";
import { dispatchIntervention } from "../api/dispatch";
import { ChannelIcon } from "./ChannelIcon";
import { useToast } from "./Toast";
import { useI18n } from "../context/I18nContext";
import type { ChannelDelivery, Champion, InterventionChannel, InterventionRecommendation } from "../types";

type Phase = "loading" | "ready" | "dispatching" | "done" | "error" | "cooloff";

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
  onVoiceSessionStart?: (payload: { interventionId: string; signedUrl: string }) => void;
}

function defaultRecipient(channel: InterventionChannel, champion: Props["champion"]): string {
  if (channel === "email")      return champion.email && champion.email !== "—" ? champion.email : "";
  if (channel === "slack")      return champion.slackContact && champion.slackContact !== "—" ? champion.slackContact : "";
  if (channel === "whatsapp")   return champion.phone && champion.phone !== "—" ? champion.phone : "";
  if (channel === "voice_call") return champion.phone && champion.phone !== "—" ? champion.phone : "";
  return "";
}

const panelEase = [0.22, 1, 0.36, 1] as const;

export function InterventionModal({
  accountId,
  accountName,
  champion,
  onClose,
  onVoiceSessionStart,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [rec, setRec] = useState<InterventionRecommendation | null>(null);
  const [cooloffMsg, setCooloffMsg] = useState("");
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState("");
  const [deliveries, setDeliveries] = useState<ChannelDelivery[]>(
    ALL_CHANNELS.map((channel) => ({ channel, status: "pending" }))
  );
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await getIntervention(accountId);
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.debug("[InterventionModal] agent OK", {
          interventionId: r.interventionId,
          status: r.status,
          requiresApproval: r.requiresApproval,
          autoApproved: r.autoApproved,
        });
        setRec(r);
        setMessage(r.messageBody);
        setRecipient(r.recipient || defaultRecipient(r.recommendedChannel, champion));
        // Si requiere aprobación humana o el status es pending_approval, bloqueamos launch.
        const needsApproval =
          r?.status === "pending_approval" ||
          r?.requiresApproval === true;
        if (needsApproval) {
          setCooloffMsg(t("modal.needsApprovalBody"));
          setPhase("cooloff");
          return;
        }
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        // Duck typing en lugar de instanceof — más robusto frente a HMR / dos copias del módulo.
        const e = err as { status?: number; message?: string; name?: string } | null | undefined;
        const status = e?.status;
        // eslint-disable-next-line no-console
        console.debug("[InterventionModal] agent ERROR", { name: e?.name, status, message: e?.message });
        if (status === 409 || (e?.message ?? "").includes("status=pending_approval") || (e?.message ?? "").includes("last intervention")) {
          setCooloffMsg(e?.message || t("modal.cooloffBody"));
          setPhase("cooloff");
          return;
        }
        setPhase("error");
        toast.push(t("toast.recError"), "error");
      }
    }

    load();
    return () => { cancelled = true; };
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
    setPhase("dispatching");
    setDeliveries(ALL_CHANNELS.map((channel) => ({ channel, status: "pending" })));
    try {
      const dispatchResult = await dispatchIntervention(
        {
          interventionId: rec.interventionId,
          channel: rec.recommendedChannel,
          recipient,
          messageBody: message,
        },
        (next) => setDeliveries(next)
      );
      if (
        rec.recommendedChannel === "voice_call" &&
        dispatchResult.signedUrl &&
        rec.interventionId
      ) {
        onVoiceSessionStart?.({
          interventionId: rec.interventionId,
          signedUrl: dispatchResult.signedUrl,
        });
      }
      setPhase("done");
      toast.push(t("toast.interventionOk"), "success");
    } catch (err) {
      setDeliveries(ALL_CHANNELS.map((channel) => ({ channel, status: "pending" })));
      setPhase("ready");
      const e = err as { message?: string } | null | undefined;
      const msg = e?.message || t("toast.interventionError");
      toast.push(msg, "error");
    }
  }

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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ALL_CHANNELS.map((ch) => {
                    const isRec = recommendedSet.has(ch);
                    return (
                      <motion.div
                        key={ch}
                        whileHover={{ y: -2 }}
                        transition={{ type: "spring", stiffness: 400, damping: 28 }}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-medium transition-colors ${isRec ? "bg-indigo-500/12 border-indigo-500/45 text-indigo-100 shadow-[0_0_20px_-8px_rgba(99,102,241,0.45)]" : "bg-slate-950/40 border-slate-800/90 text-slate-500"}`}
                      >
                        <ChannelIcon channel={ch} />
                        <span>{t(`channel.${ch}` as string)}</span>
                        {isRec && <span className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">{t("modal.suggested")}</span>}
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              <div className="px-6 pt-4 space-y-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    {t("modal.recipient")}
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    disabled={phase !== "ready"}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/55 focus:ring-1 focus:ring-indigo-500/25 disabled:opacity-60 transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                    {t("modal.contacts", { name: champion.name })}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {([
                      { icon: "✉", label: "Email",   value: champion.email,        channel: "email" as InterventionChannel },
                      { icon: "💬", label: "Slack",  value: champion.slackContact, channel: "slack" as InterventionChannel },
                      { icon: "📞", label: "Tel/WA", value: champion.phone,        channel: "voice_call" as InterventionChannel },
                    ] as const).map(({ icon, label, value }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={phase !== "ready" || !value || value === "—"}
                        onClick={() => setRecipient(value ?? "")}
                        title={value || "N/A"}
                        className="text-left px-3 py-2 bg-slate-950/40 border border-slate-800 rounded-lg hover:bg-slate-800/70 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35"
                      >
                        <div className="text-[10px] text-slate-500">{icon} {label}</div>
                        <div className="text-xs text-slate-200 truncate">{value && value !== "—" ? value : "—"}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{t("modal.clickToUse")}</p>
                </div>
              </div>

              <div className="px-6 pt-4 pb-1">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  {t("modal.message")}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={phase !== "ready"}
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
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:via-indigo-500 hover:to-violet-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {t("modal.launch")}
                  </motion.button>
                )}

                {phase === "dispatching" && (
                  <span className="text-sm font-medium text-indigo-300 flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin" />
                    {t("modal.launching", { n: ALL_CHANNELS.length })}
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
