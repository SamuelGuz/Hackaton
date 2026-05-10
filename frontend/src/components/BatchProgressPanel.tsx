import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useI18n } from "../context/I18nContext";
import { CompanyAvatar } from "./CompanyAvatar";
import { ChannelIcon } from "./ChannelIcon";
import type {
  BatchAccountResult,
  BatchAccountStep,
  BatchDispatchChannel,
  BatchDispatchResult,
  BatchDispatchStatus,
  BatchStatus,
  BatchStepName,
  BatchStepStatus,
} from "../api/agents";

const STEP_ORDER: BatchStepName[] = ["crystal_ball", "expansion", "intervention"];

const stepToneClass: Record<BatchStepStatus, string> = {
  queued: "bg-slate-800/60 border-slate-700/60 text-slate-400",
  running: "bg-indigo-500/15 border-indigo-500/40 text-indigo-200",
  done: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  failed: "bg-rose-500/15 border-rose-500/40 text-rose-200",
  skipped: "bg-amber-500/10 border-amber-500/30 text-amber-200",
};

function StepIcon({ status }: { status: BatchStepStatus }) {
  if (status === "running") {
    return (
      <span className="w-3 h-3 border-2 border-indigo-400/40 border-t-indigo-200 rounded-full animate-spin" />
    );
  }
  if (status === "done") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    );
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />;
}

function StepChip({ step }: { step: BatchAccountStep }) {
  const { t } = useI18n();
  const tone = stepToneClass[step.status];
  const label = t(`inv.batchStep.${step.step}`);
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-semibold uppercase tracking-wide ${tone}`}
      title={step.error ?? undefined}
    >
      <StepIcon status={step.status} />
      <span>{label}</span>
    </div>
  );
}

const dispatchToneClass: Record<BatchDispatchStatus, string> = {
  sent: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  failed: "bg-rose-500/15 border-rose-500/40 text-rose-200",
  skipped: "bg-slate-700/40 border-slate-600/40 text-slate-400",
};

function DispatchStatusIcon({ status }: { status: BatchDispatchStatus }) {
  if (status === "sent") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DispatchChip({ result }: { result: BatchDispatchResult }) {
  const { t } = useI18n();
  const tone = dispatchToneClass[result.status];
  const channelLabel = t(`inv.batchChannel.${result.channel as BatchDispatchChannel}`);
  const statusLabel = t(`inv.batchDispatch.${result.status}`);
  const tooltip =
    result.status === "failed" && result.error
      ? t("inv.batchDispatch.tooltipError", { error: result.error })
      : result.status === "skipped"
      ? t("inv.batchDispatch.skipped")
      : `${channelLabel} · ${statusLabel}`;
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-semibold uppercase tracking-wide ${tone}`}
      title={tooltip}
    >
      <span className="opacity-80">
        <ChannelIcon channel={result.channel} />
      </span>
      <span>{channelLabel}</span>
      <DispatchStatusIcon status={result.status} />
    </div>
  );
}

function AccountRow({ account }: { account: BatchAccountResult }) {
  const stepByName = useMemo(() => {
    const map = new Map<BatchStepName, BatchAccountStep>();
    account.steps.forEach((s) => map.set(s.step, s));
    return map;
  }, [account.steps]);

  const overallTone =
    account.overallStatus === "done"
      ? "text-emerald-300"
      : account.overallStatus === "failed"
      ? "text-rose-300"
      : account.overallStatus === "running"
      ? "text-indigo-300"
      : "text-slate-400";

  const dispatchResults = account.dispatchResults ?? [];

  return (
    <div className="flex flex-col gap-2 py-3 px-3 rounded-lg bg-slate-900/40 border border-slate-800/60">
      <div className="flex items-center gap-3">
        <CompanyAvatar name={account.accountName ?? account.accountId} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">
            {account.accountName ?? account.accountId}
          </p>
          <p className={`text-[10px] uppercase tracking-widest font-semibold ${overallTone}`}>
            {account.overallStatus}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {STEP_ORDER.map((stepName) => {
            const step =
              stepByName.get(stepName) ??
              ({ step: stepName, status: "queued" as const, startedAt: null, finishedAt: null, error: null, resultSummary: null } satisfies BatchAccountStep);
            return <StepChip key={stepName} step={step} />;
          })}
        </div>
      </div>
      {dispatchResults.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pl-11">
          {dispatchResults.map((r) => (
            <DispatchChip key={r.channel} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface BatchProgressPanelProps {
  status: BatchStatus | null;
  isRunning: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * Overlay modal con progreso por cuenta para el agente batch.
 *
 * Recibe el estado tal cual lo devuelve `useBatchAgents`. Mientras
 * `isRunning` o no hay `status` aún, el botón cerrar queda deshabilitado:
 * forzar el cierre dejaría el polling huérfano (el hook sigue corriendo en
 * el padre).
 */
export function BatchProgressPanel({
  status,
  isRunning,
  error,
  onClose,
}: BatchProgressPanelProps) {
  const { t } = useI18n();

  const summary = useMemo(() => {
    if (!status) return { done: 0, failed: 0, skipped: 0, total: 0 };
    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const acc of status.accounts) {
      if (acc.overallStatus === "done") done += 1;
      if (acc.overallStatus === "failed") failed += 1;
      // "skipped" no es estado overall — lo derivamos del paso intervention
      const iv = acc.steps.find((s) => s.step === "intervention");
      if (iv?.status === "skipped") skipped += 1;
    }
    return { done, failed, skipped, total: status.accounts.length };
  }, [status]);

  const canClose = !isRunning;

  return (
    <AnimatePresence>
      <motion.div
        key="batch-backdrop"
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={canClose ? onClose : undefined}
      >
        <motion.div
          key="batch-panel"
          role="dialog"
          aria-modal="true"
          aria-label={t("inv.batchPanelTitle")}
          className="w-full max-w-2xl bg-slate-950/95 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, y: -20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                {t("inv.batchPanelTitle")}
              </h2>
              <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                {status
                  ? t(`inv.batchOverall.${status.overallStatus}`)
                  : t("inv.batchOverall.queued")}
                {summary.total > 0 ? ` · ${summary.done}/${summary.total}` : null}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!canClose}
              title={canClose ? undefined : t("inv.batchInProgress")}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-700/70 text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("inv.batchClose")}
            </button>
          </header>

          <div className="px-5 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {error && (
              <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
                {error}
              </div>
            )}
            {!status && !error && (
              <p className="text-xs text-slate-500 py-8 text-center">
                {t("inv.batchOverall.queued")}…
              </p>
            )}
            {status?.accounts.map((acc) => (
              <AccountRow key={acc.accountId} account={acc} />
            ))}
          </div>

          {status && (
            <footer className="px-5 py-3 border-t border-slate-800/80 bg-slate-900/40 text-[11px] text-slate-400 tabular-nums">
              {t("inv.batchSummary", {
                done: summary.done,
                failed: summary.failed,
                skipped: summary.skipped,
              })}
            </footer>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
