import type { AccountSummary, HealthStatus } from "../types";
import type { CellValue } from "./excelParser";

export type FieldKey =
  | "ignore"
  | "accountNumber"
  | "name"
  | "industry"
  | "size"
  | "geography"
  | "plan"
  | "arrUsd"
  | "seatsPurchased"
  | "seatsActive"
  | "signupDate"
  | "championName"
  | "championEmail"
  | "championPhone"
  | "championRole"
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

/** Enums acordados con el backend (ver docs/api-import-endpoints.md). */
export const ENUM_VALUES: Partial<Record<FieldKey, readonly string[]>> = {
  industry: ["fintech", "healthtech", "ecommerce", "saas", "edtech", "logistics", "professional_services", "media", "travel", "other"],
  size: ["startup", "smb", "mid_market", "enterprise"],
  geography: ["latam", "us", "eu", "apac"],
  plan: ["starter", "growth", "business", "enterprise"],
  healthStatus: ["critical", "at_risk", "stable", "healthy", "expanding"],
};

export const TARGET_FIELDS: FieldDef[] = [
  { key: "accountNumber",        label: "Nº cuenta",        required: false, hint: "Identificador único del cliente (ACC-2024-XXXX)", aliases: ["account_number", "num_cuenta", "numero_cuenta", "account_no", "account_id", "customer_id", "client_id", "id_cuenta", "numero_de_cuenta"] },
  { key: "name",                 label: "Empresa",          required: true,  hint: "Nombre de la cuenta",                  aliases: ["name", "company", "account", "empresa", "cliente", "customer", "company_name", "account_name"] },
  { key: "arrUsd",               label: "ARR (USD)",        required: true,  hint: "Annual recurring revenue en USD",      aliases: ["arr", "arr_usd", "revenue", "ingresos", "annual_revenue", "value", "mrr", "tcv"] },
  { key: "industry",             label: "Industria",        required: true,  hint: "fintech, healthtech, ecommerce, etc.", aliases: ["industry", "industria", "vertical", "sector", "category"] },
  { key: "size",                 label: "Tamaño",           required: true,  hint: "startup, smb, mid_market, enterprise", aliases: ["size", "tamaño", "tamano", "tier", "segment", "company_size"] },
  { key: "geography",            label: "Geografía",        required: true,  hint: "latam, us, eu, apac",                  aliases: ["geography", "region", "country", "pais", "país", "geo", "zona"] },
  { key: "plan",                 label: "Plan",             required: true,  hint: "starter, growth, business, enterprise", aliases: ["plan", "subscription", "tier", "package", "level"] },
  { key: "seatsPurchased",       label: "Seats comprados",  required: true,  hint: "Cantidad total de licencias contratadas", aliases: ["seats", "seats_purchased", "licencias", "licenses", "puestos", "total_seats"] },
  { key: "seatsActive",          label: "Seats activos",    required: true,  hint: "Usuarios activos del último mes",      aliases: ["seats_active", "active_seats", "usuarios_activos", "mau", "active_users"] },
  { key: "signupDate",           label: "Fecha de alta",    required: true,  hint: "Cuándo se firmó el contrato inicial",  aliases: ["signup_date", "fecha_alta", "start_date", "created_at", "onboarded", "signed_at"] },
  { key: "championName",         label: "Champion",         required: true,  hint: "Contacto principal en el cliente",     aliases: ["champion", "champion_name", "nombre_champion", "contact", "primary_contact", "owner_name", "main_contact"] },
  { key: "championEmail",        label: "Email champion",   required: true,  hint: "Email del champion (clave de dedupe)", aliases: ["champion_email", "email_champion", "email", "contact_email", "primary_email", "correo", "mail"] },
  { key: "championRole",         label: "Cargo champion",   required: true,  hint: "Rol/cargo del champion",               aliases: ["champion_role", "role", "cargo", "title", "puesto", "job_title"] },
  { key: "championPhone",        label: "Teléfono",         required: false, hint: "WhatsApp / llamada de voz (+57...)",    aliases: ["phone", "telefono", "champion_phone", "phone_number", "whatsapp", "mobile", "celular", "tel", "movil"] },
  { key: "slackContact",         label: "Slack",            required: false, hint: "@handle o #canal de Slack",            aliases: ["slack", "slack_channel", "slack_handle", "slack_id", "slack_user"] },
  { key: "csmAssigned",          label: "CSM asignado",     required: true,  hint: "Nombre del CSM (debe existir en el equipo)", aliases: ["csm", "csm_assigned", "csm_asignado", "owner", "account_owner", "manager", "rep"] },
  { key: "contractRenewalDate",  label: "Renovación",       required: true,  hint: "Fecha de renovación del contrato",     aliases: ["renewal", "contract_renewal_date", "fecha_renovacion", "renewal_date", "expires", "end_date", "contract_end"] },
  { key: "churnRiskScore",       label: "Score de churn",   required: false, hint: "0-100, riesgo de abandono",            aliases: ["churn_risk_score", "score_churn", "churn_risk", "risk_score", "churn", "churn_score"] },
  { key: "expansionScore",       label: "Score expansión",  required: false, hint: "0-100, oportunidad de upsell",         aliases: ["expansion_score", "score_expansion", "expansion", "upsell_score", "growth_score"] },
  { key: "healthStatus",         label: "Health status",    required: false, hint: "critical, at_risk, stable, healthy",   aliases: ["health_status", "health", "status", "estado"] },
];

const FIELD_BY_KEY = new Map(TARGET_FIELDS.map((f) => [f.key, f]));

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

/** Excel serial date to JS Date (1900 epoch). Returns null if out of range. */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 100000) return null;
  // Excel epoch starts on 1899-12-30 (with the 1900 leap-year bug accounted for).
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d;
}

function parseDate(raw: CellValue): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") return excelSerialToDate(raw);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    // Try ISO and common locales first.
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // Try DD/MM/YYYY or DD-MM-YYYY.
    const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (m) {
      const [, dd, mm, yy] = m;
      const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
      const d2 = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
      if (!isNaN(d2.getTime())) return d2;
    }
    // Last resort: maybe the string holds an Excel serial (e.g. "46122").
    if (/^\d+(\.\d+)?$/.test(s)) {
      const d3 = excelSerialToDate(Number(s));
      if (d3) return d3;
    }
    return null;
  }
  return null;
}

/** Coerced value or { error } describing why coercion failed. */
type CoerceResult = { value: unknown } | { error: string };

function coerce(raw: CellValue, field: FieldKey): CoerceResult {
  const isEmpty =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "");
  if (isEmpty) return { value: undefined };

  switch (field) {
    case "arrUsd": {
      const cleaned = String(raw).trim().replace(/[$,\s]/g, "").replace(/usd$/i, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return { error: `valor "${raw}" no es un número` };
      if (n < 0) return { error: "ARR no puede ser negativo" };
      return { value: n };
    }
    case "churnRiskScore":
    case "expansionScore": {
      const cleaned = String(raw).trim().replace(/[%,\s]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return { error: `valor "${raw}" no es un número` };
      if (n < 0 || n > 100) return { error: `debe estar entre 0 y 100 (recibido: ${n})` };
      return { value: Math.round(n) };
    }
    case "seatsPurchased":
    case "seatsActive": {
      const cleaned = String(raw).trim().replace(/[,\s]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return { error: `valor "${raw}" no es un número` };
      if (n < 0) return { error: "no puede ser negativo" };
      return { value: Math.trunc(n) };
    }
    case "contractRenewalDate":
    case "signupDate": {
      const d = parseDate(raw);
      if (!d) {
        return {
          error: `fecha inválida "${raw}". Usa formato YYYY-MM-DD o una celda con formato fecha en Excel`,
        };
      }
      return { value: d.toISOString() };
    }
    case "industry":
    case "size":
    case "geography":
    case "plan":
    case "healthStatus": {
      const norm = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
      if (!norm) return { value: undefined };
      const allowed = ENUM_VALUES[field];
      if (allowed && !allowed.includes(norm)) {
        return {
          error: `valor "${raw}" no permitido. Valores válidos: ${allowed.join(", ")}`,
        };
      }
      return { value: norm };
    }
    case "championEmail": {
      const s = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return { error: `email inválido "${raw}"` };
      }
      return { value: s };
    }
    case "accountNumber":
    case "name":
    case "championName":
    case "championRole":
    case "championPhone":
    case "slackContact":
    case "csmAssigned":
      return { value: String(raw).trim() };
    default:
      return { value: String(raw).trim() };
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

/** Detailed cell-level validation problem. */
export interface CellIssue {
  rowIndex: number;
  rowNumber: number;
  field: FieldKey;
  fieldLabel: string;
  rawValue: string;
  message: string;
  level: "error" | "warning";
}

export interface CommitResult {
  accounts: AccountSummary[];
  /** Indices (0-based) of rows successfully built. */
  validRowIndexes: number[];
  /** Cell-level issues — at least one error makes that row excluded from `accounts`. */
  issues: CellIssue[];
  /** Mapping-level errors (e.g. required field not mapped). */
  mappingErrors: string[];
}

export function buildAccounts(
  rows: Record<string, CellValue>[],
  mapping: Record<string, FieldKey>,
  knownCsmNames: string[] = []
): CommitResult {
  const issues: CellIssue[] = [];
  const mappingErrors: string[] = [];
  const accounts: AccountSummary[] = [];
  const validRowIndexes: number[] = [];

  const mappedFields = new Set(Object.values(mapping));
  for (const def of TARGET_FIELDS) {
    if (def.required && !mappedFields.has(def.key)) {
      mappingErrors.push(`Falta mapear el campo requerido "${def.label}".`);
    }
  }
  if (mappingErrors.length > 0) {
    return { accounts, validRowIndexes, issues, mappingErrors };
  }

  const csmLookup = new Set(knownCsmNames.map((n) => n.trim().toLowerCase()));

  type RawAcc = Omit<Partial<AccountSummary>, "csm"> & {
    csmAssigned?: string;
    championEmail?: string;
    championPhone?: string;
    championRole?: string;
    slackContact?: string;
    accountNumber?: string;
  };

  rows.forEach((row, idx) => {
    const acc: RawAcc = {};
    let rowHasError = false;

    for (const [header, field] of Object.entries(mapping)) {
      if (field === "ignore") continue;
      const raw = row[header];
      const isEmpty =
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim() === "");
      const def = FIELD_BY_KEY.get(field);

      if (isEmpty) {
        if (def?.required) {
          issues.push({
            rowIndex: idx,
            rowNumber: idx + 2,
            field,
            fieldLabel: def.label,
            rawValue: "",
            message: "campo requerido vacío",
            level: "error",
          });
          rowHasError = true;
        }
        continue;
      }

      const result = coerce(raw, field);
      if ("error" in result) {
        issues.push({
          rowIndex: idx,
          rowNumber: idx + 2,
          field,
          fieldLabel: def?.label ?? field,
          rawValue: raw instanceof Date ? raw.toISOString() : String(raw),
          message: result.error,
          level: "error",
        });
        rowHasError = true;
        continue;
      }
      if (result.value === undefined) continue;
      // @ts-expect-error -- asignación dinámica controlada
      acc[field] = result.value;
    }

    // Cross-field validation
    if (
      typeof acc.seatsPurchased === "number" &&
      typeof acc.seatsActive === "number" &&
      acc.seatsActive > acc.seatsPurchased
    ) {
      issues.push({
        rowIndex: idx,
        rowNumber: idx + 2,
        field: "seatsActive",
        fieldLabel: "Seats activos",
        rawValue: String(acc.seatsActive),
        message: `seats activos (${acc.seatsActive}) > seats comprados (${acc.seatsPurchased})`,
        level: "warning",
      });
    }

    if (acc.csmAssigned && csmLookup.size > 0) {
      const norm = acc.csmAssigned.trim().toLowerCase();
      if (!csmLookup.has(norm)) {
        issues.push({
          rowIndex: idx,
          rowNumber: idx + 2,
          field: "csmAssigned",
          fieldLabel: "CSM asignado",
          rawValue: acc.csmAssigned,
          message: `CSM "${acc.csmAssigned}" no existe en el equipo. Disponibles: ${knownCsmNames.join(", ") || "—"}`,
          level: "error",
        });
        rowHasError = true;
      }
    }

    if (rowHasError) return;

    if (!acc.name || typeof acc.arrUsd !== "number") {
      issues.push({
        rowIndex: idx,
        rowNumber: idx + 2,
        field: !acc.name ? "name" : "arrUsd",
        fieldLabel: !acc.name ? "Empresa" : "ARR (USD)",
        rawValue: "",
        message: "campo requerido vacío",
        level: "error",
      });
      return;
    }

    const churn = typeof acc.churnRiskScore === "number" ? acc.churnRiskScore : 0;
    const expansion = typeof acc.expansionScore === "number" ? acc.expansionScore : 0;
    const health = (acc.healthStatus && VALID_HEALTH.includes(acc.healthStatus as HealthStatus))
      ? (acc.healthStatus as HealthStatus)
      : deriveHealthStatus(churn, expansion);

    accounts.push({
      id: `imported-${Date.now()}-${idx}`,
      accountNumber: acc.accountNumber ? String(acc.accountNumber) : null,
      name: String(acc.name),
      industry: acc.industry || "professional_services",
      size: acc.size || "smb",
      geography: acc.geography || "latam",
      plan: acc.plan || "growth",
      arrUsd: acc.arrUsd,
      seatsPurchased: typeof acc.seatsPurchased === "number" ? acc.seatsPurchased : 0,
      seatsActive: typeof acc.seatsActive === "number" ? acc.seatsActive : 0,
      signupDate: acc.signupDate || new Date(Date.now() - 365 * 86400 * 1000).toISOString(),
      championName: acc.championName || "—",
      championRole: acc.championRole || "Champion",
      csm: {
        id: `imported-csm-${Date.now()}-${idx}`,
        name: acc.csmAssigned || "—",
        email: "",
        slackHandle: null,
      },
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
    validRowIndexes.push(idx);
  });

  return { accounts, validRowIndexes, issues, mappingErrors };
}

type TFn = (key: string) => string;

export function fieldLabel(key: FieldKey, t?: TFn): string {
  if (key === "ignore") return t ? t("fieldLabel.ignore") : "— ignore column —";
  if (t) return t(`fieldLabel.${key}`);
  return FIELD_BY_KEY.get(key)?.label ?? key;
}
