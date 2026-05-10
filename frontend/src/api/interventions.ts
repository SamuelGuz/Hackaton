import { apiFetch, USE_MOCK } from "./client";
import { mockInterventions } from "../mocks/interventions";
import type {
  Intervention,
  InterventionsResponse,
  InterventionStatus,
  InterventionChannel,
  InterventionOutcome,
} from "../types";

export interface InterventionFilters {
  status?: InterventionStatus;
  channel?: InterventionChannel;
  accountId?: string;
  limit?: number;
  offset?: number;
}

export async function getInterventions(
  filters: InterventionFilters = {}
): Promise<InterventionsResponse> {
  if (USE_MOCK) {
    let list = mockInterventions;
    if (filters.status) list = list.filter((i) => i.status === filters.status);
    if (filters.channel) list = list.filter((i) => i.channel === filters.channel);
    if (filters.accountId) list = list.filter((i) => i.accountId === filters.accountId);
    return { interventions: list, total: list.length };
  }

  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.accountId) params.set("account_id", filters.accountId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  const path = qs ? `/interventions?${qs}` : "/interventions";
  return apiFetch<InterventionsResponse>(path);
}

export interface OutcomePayload {
  outcome: InterventionOutcome;
  outcomeNotes?: string | null;
}

export interface OutcomeResult {
  interventionId: string;
  outcomeRecorded: boolean;
  playbookUpdated?: {
    playbookId: string;
    previousSuccessRate: number;
    newSuccessRate: number;
    timesUsed: number;
    deprecated: boolean;
  } | null;
}

export async function recordOutcome(
  interventionId: string,
  payload: OutcomePayload
): Promise<OutcomeResult> {
  if (USE_MOCK) {
    return {
      interventionId,
      outcomeRecorded: true,
      playbookUpdated: null,
    };
  }
  // Backend espera snake_case en el body
  const body = JSON.stringify({
    outcome: payload.outcome,
    outcome_notes: payload.outcomeNotes ?? null,
  });
  return apiFetch<OutcomeResult>(`/interventions/${interventionId}/outcome`, {
    method: "POST",
    body,
  });
}

export type { Intervention };
