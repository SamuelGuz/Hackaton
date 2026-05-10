import { useEffect, useState } from "react";
import { getIntervention } from "../api/agents";
import { dispatchIntervention } from "../api/dispatch";
import { ChannelIcon } from "./ChannelIcon";
import { useToast } from "./Toast";
import { useI18n } from "../context/I18nContext";
import type { ChannelDelivery, Champion, InterventionChannel, InterventionRecommendation } from "../types";

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
}

function defaultRecipient(channel: InterventionChannel, champion: Props["champion"]): string {
  if (channel === "email")      return champion.email && champion.email !== "—" ? champion.email : "";
  if (channel === "slack")      return champion.slackContact && champion.slackContact !== "—" ? champion.slackContact : "";
  if (channel === "whatsapp")   return champion.phone && champion.phone !== "—" ? champion.phone : "";
  if (channel === "voice_call") return champion.phone && champion.phone !== "—" ? champion.phone : "";
  return "";
}

export function InterventionModal({ accountId, accountName, champion, onClose }: Props) {
  const { t } = useI18n();
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
        setRecipient(r.recipient || defaultRecipient(r.recommendedChannel, champion));
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
        toast.push(t("toast.recError"), "error");
      });
    return () => { cancelled = true; };
  }, [accountId, champion, toast, t]);

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
        { channel: rec.recommendedChannel, recipient, messageBody: message },
        (next) => setDeliveries(next)
      );
      setPhase("done");
      toast.push(t("toast.interventionOk"), "success");
    } catch {
      setPhase("error");
      toast.push(t("toast.interventionError"), "error");
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
              {t("modal.title", { name: accountName })}
            </p>
            <h2 className="text-lg font-semibold text-white">
              {phase === "done" ? t("modal.titleDone") : t("modal.titleReady")}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={phase === "dispatching"}
            className="text-slate-500 hover:text-white p-1 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Loading */}
        {phase === "loading" && (
          <div className="p-12 text-center text-slate-400">
            <div className="w-8 h-8 mx-auto mb-3 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />
            <p className="text-sm">{t("modal.generating")}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="p-12 text-center text-rose-400 text-sm">{t("modal.noRec")}</div>
        )}

        {(phase === "ready" || phase === "dispatching" || phase === "done") && rec && (
          <>
            {/* Agent reasoning */}
            <div className="mx-6 mt-5 p-3.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-300"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
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

            {/* Channel selector */}
            <div className="px-6 pt-5">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                {t("modal.channel")}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {ALL_CHANNELS.map((ch) => {
                  const isRec = recommendedSet.has(ch);
                  return (
                    <div
                      key={ch}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs font-medium transition-colors ${isRec ? "bg-indigo-500/10 border-indigo-500/50 text-indigo-200" : "bg-slate-800/40 border-slate-800 text-slate-500"}`}
                    >
                      <ChannelIcon channel={ch} />
                      <span>{t(`channel.${ch}` as any)}</span>
                      {isRec && <span className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">{t("modal.suggested")}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recipient + champion contacts */}
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
                  className="w-full bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                  {t("modal.contacts", { name: champion.name })}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { icon: "✉", label: "Email",   value: champion.email,        channel: "email" as InterventionChannel },
                    { icon: "💬", label: "Slack",  value: champion.slackContact, channel: "slack" as InterventionChannel },
                    { icon: "📞", label: "Tel/WA", value: champion.phone,        channel: "voice_call" as InterventionChannel },
                  ] as const).map(({ icon, label, value }) => (
                    <button
                      key={label}
                      disabled={phase !== "ready" || !value || value === "—"}
                      onClick={() => setRecipient(value ?? "")}
                      title={value || "N/A"}
                      className="text-left px-2 py-1.5 bg-slate-800/40 border border-slate-700 rounded-md hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <div className="text-[10px] text-slate-500">{icon} {label}</div>
                      <div className="text-xs text-slate-200 truncate">{value && value !== "—" ? value : "—"}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{t("modal.clickToUse")}</p>
              </div>
            </div>

            {/* Message */}
            <div className="px-6 pt-4 pb-2">
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">
                {t("modal.message")}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={phase !== "ready"}
                rows={5}
                className="w-full bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2.5 text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500/60 disabled:opacity-60 resize-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">{t("modal.messageHint")}</p>
            </div>

            {/* Delivery status */}
            {(phase === "dispatching" || phase === "done") && (
              <div className="px-6 pt-2 pb-2">
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-2">
                  {t("modal.deliveryStatus")}
                </label>
                <div className="space-y-2">
                  {deliveries.map((d) => (
                    <div
                      key={d.channel}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${d.status === "delivered" ? "bg-emerald-500/5 border-emerald-500/30" : "bg-slate-800/30 border-slate-800"}`}
                    >
                      <StatusDot status={d.status} />
                      <span className="text-slate-300 shrink-0"><ChannelIcon channel={d.channel} /></span>
                      <span className="text-sm font-medium text-slate-200 flex-1">{t(`channel.${d.channel}` as any)}</span>
                      <span className={`text-xs font-medium ${d.status === "delivered" ? "text-emerald-300" : d.status === "failed" ? "text-rose-300" : d.status === "sent" ? "text-indigo-300" : "text-slate-500"}`}>
                        {statusLabel(d.status)}
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
                {allDelivered ? t("modal.close") : t("modal.cancel")}
              </button>

              {phase === "ready" && (
                <button
                  onClick={launch}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-br from-rose-500 to-orange-500 text-white text-sm font-semibold rounded-md shadow-lg shadow-rose-500/20 hover:from-rose-400 hover:to-orange-400 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("modal.launch")}
                </button>
              )}

              {phase === "dispatching" && (
                <span className="text-sm font-medium text-indigo-300 flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin" />
                  {t("modal.launching", { n: ALL_CHANNELS.length })}
                </span>
              )}

              {phase === "done" && (
                <span className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  {t("modal.done")}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
