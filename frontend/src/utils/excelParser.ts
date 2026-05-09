import * as XLSX from "xlsx";

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, string | number>[];
  totalRows: number;
}

export async function parseFile(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("The file contains no valid sheets.");

  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (aoa.length === 0) throw new Error("The sheet is empty.");

  const headers = (aoa[0] as (string | number)[]).map((h) => String(h).trim());
  const rows = (aoa.slice(1) as (string | number)[][]).map((row) => {
    const obj: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = v === undefined || v === null ? "" : v;
    });
    return obj;
  });

  return { sheetName, headers, rows, totalRows: rows.length };
}

// Columnas del template en orden — las claves referencian "col.*" en translations.ts
const TEMPLATE_FIELD_KEYS = [
  "col.name",
  "col.industry",
  "col.size",
  "col.plan",
  "col.arrUsd",
  "col.championName",
  "col.championEmail",
  "col.championPhone",
  "col.slackContact",
  "col.csmAssigned",
  "col.contractRenewalDate",
  "col.churnRiskScore",
  "col.expansionScore",
] as const;

type TFn = (key: string) => string;

export function downloadTemplate(t: TFn) {
  // Genera los headers traducidos en el idioma actual
  const headers = TEMPLATE_FIELD_KEYS.map((key) => t(key));

  // Datos de ejemplo — los valores son los enums que el sistema espera (inglés)
  const sampleValues = [
    [
      "Acme Corp", "fintech", "mid_market", "growth", 48000,
      "María Pérez", "maria@acmecorp.com", "+57 300 1234567", "@maria.perez",
      "Carlos López", "2026-08-15", 91, 14,
    ],
    [
      "BetaCo", "ecommerce", "smb", "starter", 18000,
      "Luis Ramírez", "luis@betaco.com", "+1 415 555 0182", "#betaco-success",
      "Ana Torres", "2026-09-01", 74, 41,
    ],
    [
      "GammaInc", "healthtech", "smb", "growth", 32000,
      "Sofia Mendez", "sofia@gammainc.com", "+52 55 1234 5678", "@sofia.mendez",
      "Martina Ruiz", "2026-12-01", 8, 88,
    ],
  ];

  // Construimos array of arrays: [headers, ...rows]
  const aoa = [headers, ...sampleValues];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Ancho de columna automático
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "accounts");
  XLSX.writeFile(wb, "churn-oracle-template.xlsx");
}
