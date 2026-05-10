import { apiFetch, USE_MOCK } from "./client";
import { mockAccountsResponse, mockAccountDetail, mockTimeline } from "../mocks/accounts";
import type {
  AccountsResponse,
  AccountDetail,
  TimelineResponse,
  ImportRequest,
  ImportResponse,
  AccountHealthHistoryResponse,
} from "../types";

export type AccountFilter = "all" | "critical" | "at_risk" | "stable" | "healthy" | "expanding";

export async function getAccounts(filter: AccountFilter = "all"): Promise<AccountsResponse> {
  if (USE_MOCK) {
    if (filter !== "all") {
      const filtered = mockAccountsResponse.accounts.filter(
        (a) => a.healthStatus === filter
      );
      return { accounts: filtered, total: filtered.length };
    }
    return mockAccountsResponse;
  }

  const params = filter !== "all" ? `?health_status=${filter}` : "";
  return apiFetch<AccountsResponse>(`/accounts${params}`);
}

export async function getAccount(id: string): Promise<AccountDetail> {
  if (USE_MOCK) return mockAccountDetail;
  return apiFetch<AccountDetail>(`/accounts/${id}`);
}

export async function getTimeline(id: string): Promise<TimelineResponse> {
  if (USE_MOCK) return mockTimeline;
  return apiFetch<TimelineResponse>(`/accounts/${id}/timeline`);
}

export async function getAccountHealthHistory(
  id: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<AccountHealthHistoryResponse> {
  if (USE_MOCK) {
    return { items: [], total: 0, limit: opts.limit ?? 100, offset: opts.offset ?? 0 };
  }
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiFetch<AccountHealthHistoryResponse>(
    `/accounts/${id}/health-history${qs ? `?${qs}` : ""}`
  );
}

export async function importAccounts(payload: ImportRequest): Promise<ImportResponse> {
  if (USE_MOCK) {
    return {
      inserted: payload.accounts.length,
      skipped: 0,
      errors: [],
      insertedIds: payload.accounts.map((_, i) => `mock-${Date.now()}-${i}`),
    };
  }
  return apiFetch<ImportResponse>("/accounts/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
