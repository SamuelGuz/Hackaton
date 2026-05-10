import { apiFetch, USE_MOCK } from "./client";
import { mockAccountsResponse, mockAccountDetail, mockTimeline } from "../mocks/accounts";
import type { AccountsResponse, AccountDetail, TimelineResponse } from "../types";

export type AccountFilter = "all" | "at_risk" | "expansion";

export async function getAccounts(filter: AccountFilter = "all"): Promise<AccountsResponse> {
  if (USE_MOCK) {
    if (filter === "at_risk") {
      const filtered = mockAccountsResponse.accounts.filter(
        (a) => a.churnRiskScore >= 60
      );
      return { accounts: filtered, total: filtered.length };
    }
    if (filter === "expansion") {
      const filtered = mockAccountsResponse.accounts.filter(
        (a) => a.expansionScore >= 60
      );
      return { accounts: filtered, total: filtered.length };
    }
    return mockAccountsResponse;
  }

  const params = filter !== "all" ? `?health_status=${filter === "at_risk" ? "at_risk,critical" : "expanding"}` : "";
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
