import { apiFetch, USE_MOCK } from "./client";
import { getMockIntervention } from "../mocks/agents";
import type { InterventionRecommendation } from "../types";

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
