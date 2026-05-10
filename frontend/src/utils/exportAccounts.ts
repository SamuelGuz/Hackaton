import * as XLSX from "xlsx";
import type { AccountSummary } from "../types";
import type { Lang } from "../i18n/translations";

type Row = (string | number)[];

const HEADERS: Record<Lang, string[]> = {
  es: [
    "#", "Nº cuenta", "Empresa", "Industria", "Tamaño", "Plan", "ARR (USD)",
    "Estado", "Riesgo Churn", "Score Expansión", "Renovación",
    "CSM", "Email CSM", "Champion",
  ],
  en: [
    "#", "Account #", "Company", "Industry", "Size", "Plan", "ARR (USD)",
    "Status", "Churn Risk", "Expansion Score", "Renewal",
    "CSM", "CSM Email", "Champion",
  ],
};

function buildRows(accounts: AccountSummary[], lang: Lang): Row[] {
  return [
    HEADERS[lang],
    ...accounts.map((a, i) => [
      i + 1,
      a.accountNumber ?? "",
      a.name,
      a.industry,
      a.size,
      a.plan,
      a.arrUsd,
      a.healthStatus,
      a.churnRiskScore,
      a.expansionScore,
      a.contractRenewalDate,
      a.csm.name,
      a.csm.email,
      a.championName,
    ]),
  ];
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportAccountsCsv(accounts: AccountSummary[], lang: Lang) {
  const aoa = buildRows(accounts, lang);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws);
  // BOM para que Excel detecte UTF-8 (acentos correctos al abrir el .csv directamente).
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `accounts-${todayStamp()}.csv`);
}

export function exportAccountsXlsx(accounts: AccountSummary[], lang: Lang) {
  const aoa = buildRows(accounts, lang);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((h, i) => ({
    wch: i === 0 ? 5 : Math.max(String(h).length + 4, 14),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "accounts");
  XLSX.writeFile(wb, `accounts-${todayStamp()}.xlsx`);
}
