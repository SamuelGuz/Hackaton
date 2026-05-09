import type { AccountSummary, HealthStatus } from "../types";

export type FieldKey =
  | "ignore"
  | "name"
  | "industry"
  | "size"
  | "plan"
  | "arrUsd"
  | "championName"
  | "championEmail"
  | "championPhone"
  | "slackContact"
  | "csmAssigned"
  | "contractRenewalDate"
  | "churnRiskScore"
  | "expansionScore"
  | "healthStatus";

export interface FieldDef {
  key: FieldKey;
  label: string;
  required: boolean;
  hint: string;
  // términos comunes (case insensitive) que el usuario podría usar como header
  aliases: string[];
}

export const TARGET_FIELDS: FieldDef[] = [
  { key: "name",                 label: "Empresa",          required: true,  hint: "Nombre de la cuenta",                  aliases: ["name", "company", "account", "empresa", "cliente", "customer", "company_name", "account_name"] },
  { key: "arrUsd",               label: "ARR (USD)",        required: true,  hint: "Annual recurring revenue en USD",      aliases: ["arr", "arr_usd", "revenue", "ingresos", "annual_revenue", "value", "mrr", "tcv"] },
  { key: "industry",             label: "Industria",        required: false, hint: "fintech, healthtech, ecommerce, etc.", aliases: ["industry", "industria", "vertical", "sector", "category"] },
  { key: "size",                 label: "Tamaño",           required: false, hint: "startup, smb, mid_market, enterprise", aliases: ["size", "tamaño", "tamano", "tier", "segment", "company_size"] },
  { key: "plan",                 label: "Plan",             required: false, hint: "starter, growth, business, enterprise", aliases: ["plan", "subscription", "tier", "package", "level"] },
  { key: "championName",         label: "Champion",         required: false, hint: "Contacto principal en el cliente",     aliases: ["champion", "champion_name", "nombre_champion", "contact", "primary_contact", "owner_name", "main_contact"] },
  { key: "championEmail",        label: "Email champion",   required: false, hint: "Email del champion para intervenciones", aliases: ["champion_email", "email_champion", "email", "contact_email", "primary_email", "correo", "mail"] },
  { key: "championPhone",        label: "Teléfono",         required: false, hint: "WhatsApp / llamada de voz (+57...)",    aliases: ["phone", "telefono", "champion_phone", "phone_number", "whatsapp", "mobile", "celular", "tel", "movil"] },
  { key: "slackContact",         label: "Slack",            required: false, hint: "@handle o #canal de Slack",            aliases: ["slack", "slack_channel", "slack_handle", "slack_id", "slack_user"] },
  { key: "csmAssigned",          label: "CSM asignado",     required: false, hint: "CSM responsable de la cuenta",         aliases: ["csm", "csm_assigned", "csm_asignado", "owner", "account_owner", "manager", "rep"] },
  { key: "contractRenewalDate",  label: "Renovación",       required: false, hint: "Fecha de renovación del contrato",     aliases: ["renewal", "contract_renewal_date", "fecha_renovacion", "renewal_date", "expires", "end_date", "contract_end"] },
  { key: "churnRiskScore",       label: "Score de churn",   required: false, hint: "0-100, riesgo de abandono",            aliases: ["churn_risk_score", "score_churn", "churn_risk", "risk_score", "churn", "churn_score"] },
  { key: "expansionScore",       label: "Score expansión",  required: false, hint: "0-100, oportunidad de upsell",         aliases: ["expansion_score", "score_expansion", "expansion", "upsell_score", "growth_score"] },
  { key: "healthStatus",         label: "Health status",    required: false, hint: "critical, at_risk, stable, healthy",   aliases: ["health_status", "health", "status", "estado"] },
];

const FIELD_BY_KEY = new Map(TARGET_FIELDS.map((f) => [f.key, f]));

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacriticals
    .replace(/[^a-z0-9]/g, "");
}

/** Sugerencia automática de mapeo header → campo. */
export function suggestMapping(headers: string[]): Record<string, FieldKey> {
  const mapping: Record<string, FieldKey> = {};
  const usedFields = new Set<FieldKey>();

  for (const header of headers) {
    const norm = normalize(header);
    let best: { field: FieldKey; score: number } = { field: "ignore", score: 0 };

    for (const def of TARGET_FIELDS) {
      if (usedFields.has(def.key)) continue;
      for (const alias of def.aliases) {
        const aliasNorm = normalize(alias);
        let score = 0;
        if (norm === aliasNorm) score = 100;
        else if (norm.includes(aliasNorm) || aliasNorm.includes(norm)) score = 70;
        if (score > best.score) best = { field: def.key, score };
      }
    }

    if (best.score >= 70) {
      mapping[header] = best.field;
      usedFields.add(best.field);
    } else {
      mapping[header] = "ignore";
    }
  }

  return mapping;
}

/** Coerce un valor crudo del Excel al tipo correcto del campo. */
function coerce(value: string | number, field: FieldKey): unknown {
  const str = String(value).trim();
  if (str === "") return undefined;

  switch (field) {
    case "arrUsd":
    case "churnRiskScore":
    case "expansionScore": {
      const cleaned = str.replace(/[$,\s]/g, "").replace(/usd$/i, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : undefined;
    }
    case "contractRenewalDate": {
      // intenta parsear formatos comunes; si falla devuelve string
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d.toISOString();
      return str;
    }
    case "industry":
    case "size":
    case "plan":
      return str.toLowerCase().replace(/\s+/g, "_");
    case "healthStatus":
      return str.toLowerCase().replace(/\s+/g, "_") as HealthStatus;
    default:
      return str;
  }
}

const VALID_HEALTH: HealthStatus[] = ["critical", "at_risk", "stable", "healthy", "expanding"];

function deriveHealthStatus(churnRisk: number, expansion: number): HealthStatus {
  if (churnRisk >= 80) return "critical";
  if (churnRisk >= 60) return "at_risk";
  if (expansion >= 60) return "expanding";
  if (churnRisk >= 30) return "stable";
  return "healthy";
}

export interface CommitResult {
  accounts: AccountSummary[];
  errors: { row: number; message: string }[];
}

export function buildAccounts(
  rows: Record<string, string | number>[],
  mapping: Record<string, FieldKey>
): CommitResult {
  const errors: { row: number; message: string }[] = [];
  const accounts: AccountSummary[] = [];

  // Validar que los campos required están mapeados
  const mappedFields = new Set(Object.values(mapping));
  for (const def of TARGET_FIELDS) {
    if (def.required && !mappedFields.has(def.key)) {
      errors.push({ row: 0, message: `Falta mapear el campo requerido "${def.label}".` });
    }
  }
  if (errors.length > 0) return { accounts, errors };

  // Tipo intermedio que incluye todos los FieldKey posibles
  type RawAcc = Partial<AccountSummary> & {
    championEmail?: string;
    championPhone?: string;
    slackContact?: string;
  };

  rows.forEach((row, idx) => {
    const acc: RawAcc = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field === "ignore") continue;
      const raw = row[header];
      if (raw === undefined || raw === "") continue;
      const coerced = coerce(raw, field);
      if (coerced === undefined) continue;
      // @ts-expect-error -- asignación dinámica controlada
      acc[field] = coerced;
    }

    if (!acc.name || !acc.arrUsd) {
      errors.push({ row: idx + 2, message: `Fila ${idx + 2}: faltan campos requeridos (name, arrUsd).` });
      return;
    }

    const churn = typeof acc.churnRiskScore === "number" ? acc.churnRiskScore : 0;
    const expansion = typeof acc.expansionScore === "number" ? acc.expansionScore : 0;
    const health = (acc.healthStatus && VALID_HEALTH.includes(acc.healthStatus as HealthStatus))
      ? (acc.healthStatus as HealthStatus)
      : deriveHealthStatus(churn, expansion);

    accounts.push({
      id: `imported-${Date.now()}-${idx}`,
      name: String(acc.name),
      industry: acc.industry || "professional_services",
      size: acc.size || "smb",
      plan: acc.plan || "growth",
      arrUsd: acc.arrUsd,
      championName: acc.championName || "—",
      csmAssigned: acc.csmAssigned || "—",
      contractRenewalDate: acc.contractRenewalDate || new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
      healthStatus: health,
      churnRiskScore: churn,
      expansionScore: expansion,
      contact: {
        email:        acc.championEmail   ? String(acc.championEmail)  : "",
        phone:        acc.championPhone   ? String(acc.championPhone)  : "",
        slackContact: acc.slackContact    ? String(acc.slackContact)   : "",
      },
    });
  });

  return { accounts, errors };
}

type TFn = (key: string) => string;

export function fieldLabel(key: FieldKey, t?: TFn): string {
  if (key === "ignore") return t ? t("fieldLabel.ignore") : "— ignore column —";
  if (t) return t(`fieldLabel.${key}`);
  return FIELD_BY_KEY.get(key)?.label ?? key;
}
