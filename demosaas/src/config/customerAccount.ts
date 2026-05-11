export type CustomerAccount = {
  id: string;
  accountNumber: string;
  name: string;
  attentionLabel: string;
  segmentLabel: string;
  csmName: string;
};

function envOr(key: keyof ImportMetaEnv, fallback: string): string {
  const v = import.meta.env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

/**
 * `name`: fallback si falla `GET /accounts/{id}` (p. ej. sin red); la fuente de verdad en runtime es la API.
 * Resto: sobreescribible con `demo_saas_VITE_ACCOUNT_*` en `.env` (defaults demo Carrión).
 */
const defaults = {
  id: "a87de295-d6a1-4257-b6e2-1bc142b005d7",
  accountNumber: "ACC-2025-00247",
  name: "Carrión A.C.",
  attentionLabel: "Crítico",
  segmentLabel: "Fintech · PyME · Latam",
  csmName: "Diego Martínez",
} as const satisfies CustomerAccount;

export const customerAccount: CustomerAccount = {
  id: envOr("demo_saas_VITE_ACCOUNT_ID", defaults.id),
  accountNumber: envOr("demo_saas_VITE_ACCOUNT_NUMBER", defaults.accountNumber),
  name: envOr("demo_saas_VITE_ACCOUNT_NAME", defaults.name),
  attentionLabel: envOr("demo_saas_VITE_ACCOUNT_ATTENTION_LABEL", defaults.attentionLabel),
  segmentLabel: envOr("demo_saas_VITE_ACCOUNT_SEGMENT", defaults.segmentLabel),
  csmName: envOr("demo_saas_VITE_ACCOUNT_CSM_NAME", defaults.csmName),
};
