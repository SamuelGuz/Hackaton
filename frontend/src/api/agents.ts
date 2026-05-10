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
