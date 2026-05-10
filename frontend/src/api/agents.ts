import { apiFetch, USE_MOCK } from "./client";
import { getMockIntervention } from "../mocks/agents";
import type { InterventionRecommendation } from "../types";

export interface RunAllResult {
  triggered: number;
  skipped: number;
  errors: { account_id: string; error: string }[];
}

export async function runAllInterventions(): Promise<RunAllResult> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800));
    return { triggered: 5, skipped: 3, errors: [] };
  }
  return apiFetch<RunAllResult>("/agents/intervention/run-all", { method: "POST" });
}

export async function getIntervention(
  accountId: string,
  triggerReason = "churn_risk_high",
  signal?: AbortSignal
): Promise<InterventionRecommendation> {
  if (USE_MOCK) {
    // simula latencia leve para feedback realista
    await new Promise((r) => setTimeout(r, 250));
    return getMockIntervention(accountId);
  }
  return apiFetch<InterventionRecommendation>(`/agents/intervention/${accountId}`, {
    method: "POST",
    body: JSON.stringify({ trigger_reason: triggerReason }),
    signal,
  });
}

// ---------------------------------------------------------------------------
// Batch agent (POST /agents/batch-process + GET /agents/batch-process/{id})
// Procesa N cuentas en paralelo a través del pipeline crystal_ball →
// expansion → intervention. apiFetch convierte snake_case → camelCase en las
// respuestas, así que los tipos reflejan la forma camelCase final.
// ---------------------------------------------------------------------------

export type BatchStepStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type BatchStepName = "crystal_ball" | "expansion" | "intervention";
export type BatchAccountOverallStatus = "queued" | "running" | "done" | "failed";
export type BatchOverallStatus = "queued" | "running" | "done" | "partial" | "failed";

// Dispatch automático (email + WhatsApp) que el batch ejecuta después de crear
// cada intervención. `skipped` = la cuenta no tiene contacto para ese canal.
export type BatchDispatchChannel = "email" | "whatsapp";
export type BatchDispatchStatus = "sent" | "failed" | "skipped";

export interface BatchDispatchResult {
  channel: BatchDispatchChannel;
  status: BatchDispatchStatus;
  recipient: string | null;
  error: string | null;
}

export interface BatchAccountStep {
  step: BatchStepName;
  status: BatchStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  resultSummary: Record<string, unknown> | null;
}

export interface BatchAccountResult {
  accountId: string;
  accountName: string | null;
  overallStatus: BatchAccountOverallStatus;
  startedAt: string | null;
  finishedAt: string | null;
  steps: BatchAccountStep[];
  interventionId: string | null;
  dispatchResults: BatchDispatchResult[];
}

export interface BatchStatus {
  batchId: string;
  createdAt: string;
  overallStatus: BatchOverallStatus;
  triggerReason: string;
  accounts: BatchAccountResult[];
}

export interface BatchSubmitResult {
  batchId: string;
  accountsQueued: number;
  pollUrl: string;
}

export async function submitBatchProcess(
  limit = 5,
  triggerReason = "manual_dashboard_trigger",
  signal?: AbortSignal,
): Promise<BatchSubmitResult> {
  return apiFetch<BatchSubmitResult>("/agents/batch-process", {
    method: "POST",
    body: JSON.stringify({ limit, trigger_reason: triggerReason }),
    signal,
  });
}

export async function getBatchStatus(
  batchId: string,
  signal?: AbortSignal,
): Promise<BatchStatus> {
  return apiFetch<BatchStatus>(`/agents/batch-process/${batchId}`, { signal });
}
