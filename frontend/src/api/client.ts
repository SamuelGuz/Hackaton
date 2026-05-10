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

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const json = await res.json();
  return convertKeys(json) as T;
}
