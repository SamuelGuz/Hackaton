import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BatchStatus,
  type BatchOverallStatus,
  getBatchStatus,
  submitBatchProcess,
} from "../api/agents";

const POLL_INTERVAL_MS = 1500;

const TERMINAL_STATUSES: ReadonlySet<BatchOverallStatus> = new Set([
  "done",
  "partial",
  "failed",
]);

export interface UseBatchAgentsApi {
  /** Estado actual del batch (null hasta el primer GET tras submit). */
  status: BatchStatus | null;
  /** True mientras hay un batch en curso (entre submit y status terminal). */
  isRunning: boolean;
  /** Mensaje de error del submit o del polling (null si todo bien). */
  error: string | null;
  /** Encola las N cuentas más nuevas y arranca el polling. */
  start: (limit?: number, triggerReason?: string) => Promise<void>;
  /** Limpia estado y detiene cualquier polling activo. */
  reset: () => void;
}

/**
 * Orquesta el ciclo submit → polling del agente batch.
 *
 * - `start()` dispara `POST /agents/batch-process` y guarda `batchId`.
 * - Un loop con `setTimeout` chained pide `GET /agents/batch-process/{id}` cada
 *   1.5 s hasta que `overall_status` sea terminal (`done` / `partial` / `failed`).
 * - Cleanup en unmount aborta el fetch en vuelo y cancela el siguiente tick.
 */
export function useBatchAgents(): UseBatchAgentsApi {
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs para que el cleanup en unmount pueda detener todo sin depender del
  // estado de React (que en ese momento ya no actualiza).
  const timeoutRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Flag que invalida polls disparados antes de un reset/unmount: evita
  // re-iniciar el loop tras un cleanup.
  const runIdRef = useRef(0);

  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    clearPending();
    setStatus(null);
    setIsRunning(false);
    setError(null);
  }, [clearPending]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      clearPending();
    };
  }, [clearPending]);

  const pollOnce = useCallback(
    async (batchId: string, runId: number): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      let next: BatchStatus;
      try {
        next = await getBatchStatus(batchId, controller.signal);
      } catch (e) {
        if (runIdRef.current !== runId) return;
        const msg = e instanceof Error ? e.message : "batch poll failed";
        // Si fue por abort, no es un error del usuario.
        if (controller.signal.aborted) return;
        setError(msg);
        setIsRunning(false);
        return;
      }
      if (runIdRef.current !== runId) return;
      setStatus(next);
      if (TERMINAL_STATUSES.has(next.overallStatus)) {
        setIsRunning(false);
        return;
      }
      timeoutRef.current = window.setTimeout(() => {
        pollOnce(batchId, runId);
      }, POLL_INTERVAL_MS);
    },
    [],
  );

  const start = useCallback(
    async (limit = 5, triggerReason = "manual_dashboard_trigger"): Promise<void> => {
      // Cancelo cualquier run previo antes de arrancar uno nuevo (re-click).
      runIdRef.current += 1;
      clearPending();
      const runId = runIdRef.current;
      setStatus(null);
      setError(null);
      setIsRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let submit;
      try {
        submit = await submitBatchProcess(limit, triggerReason, controller.signal);
      } catch (e) {
        if (runIdRef.current !== runId) return;
        const msg = e instanceof Error ? e.message : "batch submit failed";
        setError(msg);
        setIsRunning(false);
        return;
      }
      if (runIdRef.current !== runId) return;
      // Primer poll inmediato para mostrar las cuentas encoladas en el panel
      // sin esperar 1.5 s; los siguientes ya van con el delay normal.
      pollOnce(submit.batchId, runId);
    },
    [clearPending, pollOnce],
  );

  return { status, isRunning, error, start, reset };
}
