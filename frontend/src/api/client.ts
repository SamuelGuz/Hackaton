const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

/** Same value as `API_KEY` in backend `.env`; required for protected routes (e.g. POST /accounts/import). */
const VITE_API_KEY = String(import.meta.env.VITE_API_KEY ?? "").trim();

function unwrapFastApiDetail(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const d = o.detail;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return d as Record<string, unknown>;
  }
  return o;
}

function errorMessageFromBody(body: unknown): string | undefined {
  const flat = unwrapFastApiDetail(body);
  if (!flat) return undefined;
  const m = flat.message;
  return typeof m === "string" ? m : undefined;
}

function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function convertKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamel(k),
        convertKeys(v),
      ])
    );
  }
  return obj;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    const flat = unwrapFastApiDetail(body);
    if (flat) {
      if (typeof flat.error === "string") this.code = flat.error;
      this.details = flat.details;
    }
  }
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers = new Headers(opts?.headers as HeadersInit | undefined);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (VITE_API_KEY) {
    headers.set("X-API-Key", VITE_API_KEY);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg =
      errorMessageFromBody(body) ??
      (body && typeof body === "object" && "message" in (body as object)
        ? String((body as { message?: unknown }).message)
        : `${res.status} ${path}`);
    throw new ApiError(res.status, msg, body);
  }
  const json = await res.json();
  return convertKeys(json) as T;
}
