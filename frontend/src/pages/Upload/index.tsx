import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseFile, downloadTemplate, type ParsedSheet } from "../../utils/excelParser";
import {
  TARGET_FIELDS, suggestMapping, buildAccounts, fieldLabel, type FieldKey,
} from "../../utils/columnMapper";
import { useDataContext } from "../../context/DataContext";
import { useToast } from "../../components/Toast";
import { SurfaceCard } from "../../components/SurfaceCard";
import { useI18n } from "../../context/I18nContext";
import { motion } from "framer-motion";
import { importAccounts } from "../../api/accounts";
import type { AccountSummary, ImportAccountRow, ImportResponse } from "../../types";

type Phase = "idle" | "parsing" | "map" | "success";

const SVG = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

function StepBadge({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${done ? "text-emerald-300" : active ? "text-white" : "text-slate-500"}`}>
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-semibold tabular-nums ${done ? "bg-emerald-500/20 border-emerald-500/60" : active ? "bg-indigo-500/20 border-indigo-500/60 text-indigo-200" : "border-slate-700"}`}>
        {done ? <svg {...SVG} width="11" height="11" strokeWidth={3}><polyline points="20 6 9 17 4 12"/></svg> : index}
      </div>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

const phaseOrder = (p: Phase) => ["idle", "map", "success"].indexOf(p);

export default function Upload() {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const { customAccounts, importedAt, reset } = useDataContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

  const STEPS = [
    { phase: "idle"    as Phase, label: t("up.step1") },
    { phase: "map"     as Phase, label: t("up.step2") },
    { phase: "success" as Phase, label: t("up.step3") },
  ];

  const requiredMissing = useMemo(() => {
    const used = new Set(Object.values(mapping));
    return TARGET_FIELDS.filter((f) => f.required && !used.has(f.key));
  }, [mapping]);

  async function handleFile(f: File) {
    setFile(f);
    setPhase("parsing");
    try {
      const result = await parseFile(f);
      if (result.totalRows === 0) {
        toast.push(t("up.toastNoRows"), "warning");
        setPhase("idle");
        return;
      }
      setParsed(result);
      setMapping(suggestMapping(result.headers));
      setPhase("map");
      toast.push(`${result.totalRows} ${t("up.toastParsed")} "${result.sheetName}"`, "info");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Unknown error", "error");
      setPhase("idle");
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function toImportRow(acc: AccountSummary): ImportAccountRow {
    return {
      account_number: acc.accountNumber ?? null,
      name: acc.name,
      industry: acc.industry,
      size: acc.size,
      geography: acc.geography ?? "latam",
      plan: acc.plan,
      arr_usd: acc.arrUsd,
      seats_purchased: acc.seatsPurchased ?? 0,
      seats_active: acc.seatsActive ?? 0,
      signup_date: acc.signupDate ?? new Date().toISOString(),
      contract_renewal_date: acc.contractRenewalDate,
      champion_name: acc.championName,
      champion_email: acc.contact?.email ?? "",
      champion_role: acc.championRole ?? "Champion",
      csm_assigned: acc.csm.name,
      churn_risk_score: acc.churnRiskScore,
      expansion_score: acc.expansionScore,
      health_status: acc.healthStatus,
    };
  }

  async function commit() {
    if (!parsed) return;
    const result = buildAccounts(parsed.rows, mapping);
    if (result.errors.length > 0) {
      toast.push(result.errors.slice(0, 2).map((e) => e.message).join(" · "), "error");
      return;
    }
    if (result.accounts.length === 0) {
      toast.push("No valid accounts generated", "error");
      return;
    }

    setImporting(true);
    try {
      const payload = { accounts: result.accounts.map(toImportRow) };
      const response = await importAccounts(payload);
      setImportResult(response);

      const summary = `${response.inserted} importadas · ${response.skipped} duplicadas · ${response.errors.length} errores`;
      const tone = response.errors.length > 0 ? "warning" : "success";
      toast.push(summary, tone);

      if (response.errors.length > 0) {
        const firstTwo = response.errors
          .slice(0, 2)
          .map((e) => `Fila ${e.rowIndex + 2} (${e.name}): ${e.message}`)
          .join(" · ");
        toast.push(firstTwo, "error");
      }

      // Limpiar el cache local para que el dashboard lea desde la DB
      reset();
      setPhase("success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  function startOver() {
    setFile(null);
    setParsed(null);
    setMapping({});
    setImportResult(null);
    setPhase("idle");
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <svg {...SVG} className="text-indigo-300"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300">{t("up.badge")}</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("up.title")}</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t("up.subtitle")}</p>
      </div>

      {customAccounts && phase !== "success" && (
        <SurfaceCard tone="emerald" hoverLift={false} motionless className="px-4 py-3 flex items-center justify-between gap-3 border-emerald-500/25">
          <div className="text-xs">
            <p className="text-emerald-300 font-semibold mb-0.5">
              {t("up.activeBanner", { n: customAccounts.length })}
            </p>
            <p className="text-slate-400">{t("up.activeAt")} {new Date(importedAt!).toLocaleString("es")}</p>
          </div>
          <button
            onClick={() => { reset(); toast.push(t("up.toastReset"), "info"); }}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            {t("up.resetDemo")}
          </button>
        </SurfaceCard>
      )}

      {/* Stepper */}
      <SurfaceCard weight="panel" tone="neutral" hoverLift={false} motionIndex={0} className="flex items-center gap-3 px-4 py-3">
        {STEPS.map((s, i) => (
          <div key={s.phase} className="flex items-center gap-3">
            <StepBadge
              index={i + 1}
              label={s.label}
              active={phase === s.phase || (phase === "parsing" && s.phase === "idle")}
              done={phaseOrder(phase) > i}
            />
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-slate-700" />}
          </div>
        ))}
      </SurfaceCard>

      {/* Idle / parsing */}
      {(phase === "idle" || phase === "parsing") && (
        <motion.div
          layout
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={[
            "relative isolate overflow-hidden rounded-2xl border-2 border-dashed p-12 text-center transition-colors duration-300",
            dragOver
              ? "border-indigo-400/70 bg-indigo-500/[0.08] shadow-[0_0_0_1px_rgba(99,102,241,0.2),0_24px_60px_-28px_rgba(79,70,229,0.35)]"
              : "border-slate-600/80 bg-slate-950/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
          ].join(" ")}
        >
          <div className="pointer-events-none absolute inset-0 sc-card-noise opacity-50" aria-hidden />
          <div className="relative z-[1]">
            {phase === "parsing" ? (
              <>
                <div className="w-10 h-10 mx-auto mb-4 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />
                <p className="text-sm text-slate-300 font-medium">{t("up.parsing")} {file?.name}...</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
                  <svg {...SVG} width="26" height="26"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
                </div>
                <p className="text-base font-semibold text-white mb-1">{t("up.dropTitle")}</p>
                <p className="text-sm text-slate-400 mb-5">{t("up.dropOr")}</p>
                <div className="flex items-center justify-center gap-2">
                  <label className="cursor-pointer px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-md transition-colors">
                    {t("up.selectFile")}
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  </label>
                  <button onClick={() => downloadTemplate(t)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5">
                    <svg {...SVG} width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {t("up.downloadTpl")}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-5">{t("up.local")}</p>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Map */}
      {phase === "map" && parsed && (
        <>
          <div className="grid lg:grid-cols-3 gap-6">
            <SurfaceCard weight="panel" tone="indigo" hoverLift={false} motionIndex={0} className="lg:col-span-2 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">{t("up.mapTitle")}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("up.mapSubtitle", { n: parsed.headers.length, sheet: parsed.sheetName })}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500 tabular-nums">{parsed.totalRows} {t("up.mapRows")}</span>
              </div>
              <div className="space-y-2">
                {parsed.headers.map((header) => {
                  const value = mapping[header] ?? "ignore";
                  const isMatched = value !== "ignore";
                  return (
                    <div key={header} className={`flex items-center gap-3 px-3 py-2 rounded-md border ${isMatched ? "bg-slate-800/40 border-slate-700" : "bg-slate-900/40 border-slate-800"}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">{t("up.colFile")}</p>
                        <p className="text-sm font-medium text-slate-100 truncate">{header}</p>
                      </div>
                      <svg {...SVG} className="text-slate-600 shrink-0"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">{t("up.colField")}</p>
                        <select
                          value={value}
                          onChange={(e) => setMapping({ ...mapping, [header]: e.target.value as FieldKey })}
                          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60"
                        >
                          <option value="ignore">{fieldLabel("ignore", t)}</option>
                          {TARGET_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {fieldLabel(f.key, t)}{f.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SurfaceCard>

            <SurfaceCard tone="sky" hoverLift={false} motionIndex={1} className="p-5 lg:sticky lg:top-24 lg:self-start">
              <h3 className="text-sm font-semibold text-white mb-3">{t("up.validTitle")}</h3>
              {requiredMissing.length === 0 ? (
                <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-md flex items-center gap-2 mb-3">
                  <svg {...SVG} width="14" height="14" strokeWidth={3} className="text-emerald-300"><polyline points="20 6 9 17 4 12"/></svg>
                  <span className="text-xs font-medium text-emerald-200">{t("up.validOk")}</span>
                </div>
              ) : (
                <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-md mb-3">
                  <p className="text-xs font-semibold text-rose-200 mb-1.5">{t("up.validMissing")}</p>
                  <ul className="space-y-0.5">
                    {requiredMissing.map((f) => <li key={f.key} className="text-xs text-rose-300">· {fieldLabel(f.key, t)}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1.5">{t("up.availFields")}</p>
              <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {TARGET_FIELDS.map((f) => (
                  <li key={f.key} className="text-[11px] text-slate-400 leading-snug">
                    <span className="text-slate-200 font-medium">{fieldLabel(f.key, t)}</span>
                    {f.required && <span className="text-rose-400 ml-1">*</span>}
                    <p className="text-slate-500">{f.hint}</p>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          </div>

          {/* Preview */}
          <SurfaceCard weight="panel" tone="neutral" surface="data" hoverLift={false} motionIndex={2} className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800/70 bg-slate-950/15">
              <h3 className="text-sm font-semibold text-white">{t("up.previewTitle")}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{t("up.previewSub")}</p>
            </div>
            <div className="co-table-wrap">
              <div className="co-table-shell overflow-x-auto">
                <table className="co-table co-table-sm co-table-head-plain text-xs">
                <thead>
                  <tr>
                    <th className="text-right tabular-nums w-[2rem] min-w-[2rem] max-w-[2rem] px-1.5 normal-case tracking-normal align-top">
                      <div className="text-slate-300 text-[11px] font-semibold">{t("dash.colIndex")}</div>
                    </th>
                    {Object.entries(mapping).filter(([, v]) => v !== "ignore").map(([header, field]) => (
                      <th key={header}>
                        <div className="text-slate-300 normal-case tracking-normal text-[11px] font-semibold">{fieldLabel(field as FieldKey, t)}</div>
                        <div className="text-[10px] text-slate-500 normal-case tracking-normal font-medium mt-0.5">{t("up.from")} "{header}"</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      <td className="text-right tabular-nums text-[11px] text-slate-500 w-[2rem] min-w-[2rem] max-w-[2rem] px-1.5">{i + 1}</td>
                      {Object.entries(mapping).filter(([, v]) => v !== "ignore").map(([header]) => (
                        <td key={header} className="text-slate-300 truncate max-w-[200px]">
                          {String(row[header] ?? "—") || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </SurfaceCard>

          <div className="flex items-center justify-between gap-3">
            <button onClick={startOver} className="text-sm font-medium text-slate-400 hover:text-white transition-colors">
              {t("up.changeFile")}
            </button>
            <button
              onClick={commit}
              disabled={requiredMissing.length > 0 || importing}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-md transition-colors"
            >
              {importing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Subiendo…
                </>
              ) : (
                <>
                  {t("up.import", { n: parsed.totalRows })}
                  <svg {...SVG} width="14" height="14"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Success */}
      {phase === "success" && importResult && (
        <SurfaceCard weight="panel" tone="emerald" hoverLift={false} motionless className="p-12 text-center bg-[linear-gradient(165deg,rgba(6,78,59,0.12)_0%,rgba(10,14,22,0.92)_45%,rgba(6,8,14,0.96)_100%)]">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg {...SVG} width="26" height="26" strokeWidth={3} className="text-emerald-300"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
            {importResult.inserted} cuentas importadas a la base
          </h2>
          <div className="flex items-center justify-center gap-6 text-sm mb-4">
            <div>
              <p className="text-emerald-300 font-semibold tabular-nums">{importResult.inserted}</p>
              <p className="text-xs text-slate-500">nuevas</p>
            </div>
            <div>
              <p className="text-slate-300 font-semibold tabular-nums">{importResult.skipped}</p>
              <p className="text-xs text-slate-500">duplicadas (omitidas)</p>
            </div>
            <div>
              <p className={`font-semibold tabular-nums ${importResult.errors.length > 0 ? "text-rose-300" : "text-slate-300"}`}>{importResult.errors.length}</p>
              <p className="text-xs text-slate-500">errores</p>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div className="text-left max-w-xl mx-auto mb-6 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-md">
              <p className="text-xs font-semibold text-rose-200 mb-1.5">Filas con error:</p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {importResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-rose-300">
                    · Fila {err.rowIndex + 2} ({err.name || "sin nombre"}): {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-center gap-2">
            <button onClick={() => navigate("/")} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-md transition-colors">
              {t("up.viewDash")}
            </button>
            <button onClick={startOver} className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-md transition-colors">
              {t("up.importAnother")}
            </button>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
