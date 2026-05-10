const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

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
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (typeof b.error === "string") this.code = b.error;
      this.details = b.details;
    }
  }
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg = (body && typeof body === "object" && "message" in (body as object)
      ? String((body as { message?: unknown }).message)
      : `${res.status} ${path}`);
    throw new ApiError(res.status, msg, body);
  }
  const json = await res.json();
  return convertKeys(json) as T;
}
