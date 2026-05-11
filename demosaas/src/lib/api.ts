import { customerAccount } from "../config/customerAccount";

const envBaseUrl = String(import.meta.env.demo_saas_VITE_API_URL ?? "").trim();
const API_BASE_URL = envBaseUrl || "/api/v1";
const API_KEY = String(import.meta.env.demo_saas_VITE_API_KEY ?? "").trim();

/**
 * `account_id` en imports; se alinea con `GET /accounts/{id}`.
 * No enviamos `account_number` en POST (evita conflicto id vs número).
 */
let rowAccountId = customerAccount.id.trim();

export function applyAccountDetailForImports(detail: { id?: string }) {
  if (detail.id != null && String(detail.id).trim() !== "") {
    rowAccountId = String(detail.id).trim();
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Campos usados en demosaas desde `GET /accounts/{id}` (JSON snake_case del backend). */
export type DemosaasAccountDetail = {
  id: string;
  name: string;
  account_number: string | null;
  industry: string;
  geography: string;
  plan: string;
  arr_usd: number;
  seats_active: number;
  seats_purchased: number;
  csm: { id: string; name: string; email: string };
  champion: { name: string; email: string };
};

export async function fetchAccountDetail(accountId: string): Promise<DemosaasAccountDetail> {
  const data = await apiFetch<Record<string, unknown>>(
    `/accounts/${encodeURIComponent(accountId)}`,
    { method: "GET" }
  );
  const csm = asRecord(data.csm);
  const champ = asRecord(data.champion);
  return {
    id: data.id != null ? String(data.id) : accountId,
    name: data.name != null ? String(data.name) : "",
    account_number:
      data.account_number != null && String(data.account_number).trim() !== ""
        ? String(data.account_number).trim()
        : null,
    industry: String(data.industry ?? ""),
    geography: String(data.geography ?? ""),
    plan: String(data.plan ?? ""),
    arr_usd: Number(data.arr_usd ?? 0),
    seats_active: Number(data.seats_active ?? 0),
    seats_purchased: Number(data.seats_purchased ?? 0),
    csm: {
      id: String(csm.id ?? ""),
      name: String(csm.name ?? "CSM"),
      email: String(csm.email ?? "").trim(),
    },
    champion: {
      name: String(champ.name ?? ""),
      email: String(champ.email ?? "").trim(),
    },
  };
}

export type TimelineEventRow = {
  type: string;
  subtype: string;
  timestamp: string;
  summary: string;
};

export type TimelineResponse = {
  account_id: string;
  events: TimelineEventRow[];
};

export async function fetchAccountTimeline(accountId: string): Promise<TimelineResponse> {
  return apiFetch<TimelineResponse>(
    `/accounts/${encodeURIComponent(accountId)}/timeline`,
    { method: "GET" }
  );
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type ImportResult = {
  inserted?: number;
  skipped?: number;
  errors?: Array<{ row_index?: number; key?: string; message?: string }>;
  inserted_ids?: string[];
  message?: string;
};

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export async function apiFetch<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (API_KEY) headers.set("X-API-Key", API_KEY);

  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const detailMessage =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? String((body as { message: string }).message)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(detailMessage, response.status, body);
  }

  return (await response.json()) as T;
}

function uniqueIsoTimestamp(): string {
  const msOffset = Math.floor(Math.random() * 1000);
  return new Date(Date.now() + msOffset).toISOString();
}

export async function importUsageEvent(featureName: string, userEmail: string): Promise<ImportResult> {
  return apiFetch<ImportResult>("/accounts/import/usage-events", {
    method: "POST",
    body: {
      rows: [
        {
          account_id: rowAccountId,
          event_type: "feature_used",
          feature_name: featureName,
          user_email: userEmail,
          occurred_at: uniqueIsoTimestamp(),
          metadata: {
            source: "demosaas",
            action: "register_usage",
          },
        },
      ],
    },
  });
}

export async function importTicket(input: {
  subject: string;
  description: string;
  priority: "low" | "medium" | "high";
}): Promise<ImportResult> {
  return apiFetch<ImportResult>("/accounts/import/tickets", {
    method: "POST",
    body: {
      rows: [
        {
          account_id: rowAccountId,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          status: "open",
          sentiment: "neutral",
          opened_at: uniqueIsoTimestamp(),
        },
      ],
    },
  });
}

export async function importConversation(input: {
  content: string;
  participants: string[];
  direction: "inbound" | "outbound";
}): Promise<ImportResult> {
  return apiFetch<ImportResult>("/accounts/import/conversations", {
    method: "POST",
    body: {
      rows: [
        {
          account_id: rowAccountId,
          channel: "email",
          direction: input.direction,
          participants: input.participants,
          subject: "Conversacion desde DemoSaaS Ops",
          content: input.content,
          sentiment: "neutral",
          occurred_at: uniqueIsoTimestamp(),
        },
      ],
    },
  });
}
