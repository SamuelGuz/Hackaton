import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { SurfaceCard } from "../../components/SurfaceCard";
import { Select, type SelectOption } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../context/I18nContext";
import { createAccount, getImportCsms, type ImportCsm } from "../../api/accounts";
import { ENUM_VALUES, fieldLabel } from "../../utils/columnMapper";
import type { CreateAccountResponse } from "../../types";

const SVG = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

type FormData = {
  name: string; account_number: string; industry: string; size: string;
  geography: string; plan: string; arr_usd: string; seats_purchased: string;
  seats_active: string; signup_date: string; contract_renewal_date: string;
  champion_name: string; champion_email: string; champion_role: string;
  champion_phone: string; csm_id: string; churn_risk_score: string;
  expansion_score: string; health_status: string; crystal_ball_reasoning: string;
};

const INITIAL: FormData = {
  name: "", account_number: "", industry: "", size: "", geography: "", plan: "",
  arr_usd: "", seats_purchased: "", seats_active: "", signup_date: "",
  contract_renewal_date: "", champion_name: "", champion_email: "",
  champion_role: "", champion_phone: "", csm_id: "", churn_risk_score: "",
  expansion_score: "", health_status: "", crystal_ball_reasoning: "",
};

const REQUIRED: (keyof FormData)[] = [
  "name", "account_number", "industry", "size", "geography", "plan",
  "arr_usd", "seats_purchased", "seats_active",
  "signup_date", "contract_renewal_date",
  "champion_name", "champion_email", "champion_role", "csm_id",
  "churn_risk_score", "expansion_score", "health_status", "crystal_ball_reasoning",
];

const HEALTH_DOT: Record<string, string> = {
  critical:  "bg-rose-500",
  at_risk:   "bg-amber-400",
  stable:    "bg-slate-400",
  healthy:   "bg-emerald-400",
  expanding: "bg-indigo-400",
};

function inputCls(error?: string) {
  return [
    "w-full bg-slate-800/60 border rounded-lg px-3 py-2.5 text-sm text-slate-100",
    "placeholder:text-slate-500 focus:outline-none transition-colors duration-200",
    error
      ? "border-rose-500/60 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
      : "border-slate-700/80 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20",
  ].join(" ");
}

function FormField({
  label, error, required, children,
}: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">
        {label}
        {required && <span className="text-rose-400 ml-1">*</span>}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            key="err"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="text-xs text-rose-400 mt-1"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHeader({
  icon, label, sub,
}: { icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 mb-6 pb-4 border-b border-slate-700/50">
      <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center text-indigo-300 shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        {sub && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{sub}</p>}
      </div>
    </div>
  );
}

export default function NewAccount() {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();

  const [csms, setCsms] = useState<ImportCsm[]>([]);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateAccountResponse | null>(null);

  useEffect(() => {
    getImportCsms().then(setCsms).catch(() => setCsms([]));
  }, []);

  function set(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormData, string>> = {};

    for (const f of REQUIRED) {
      if (!form[f].trim()) next[f] = t("newAcc.errRequired");
    }

    if (form.champion_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.champion_email)) {
      next.champion_email = t("newAcc.errEmail");
    }

    for (const f of ["arr_usd", "seats_purchased", "seats_active"] as const) {
      if (form[f] && Number(form[f]) < 0) next[f] = t("newAcc.errPositive");
    }

    for (const f of ["churn_risk_score", "expansion_score"] as const) {
      if (form[f]) {
        const v = Number(form[f]);
        if (v < 0 || v > 100) next[f] = t("newAcc.errScore");
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const response = await createAccount({
        account_number: form.account_number || null,
        name: form.name,
        industry: form.industry,
        size: form.size,
        geography: form.geography,
        plan: form.plan,
        arr_usd: Number(form.arr_usd),
        seats_purchased: Number(form.seats_purchased),
        seats_active: Number(form.seats_active),
        signup_date: new Date(form.signup_date).toISOString(),
        contract_renewal_date: new Date(form.contract_renewal_date).toISOString(),
        champion_name: form.champion_name,
        champion_email: form.champion_email,
        champion_role: form.champion_role,
        champion_phone: form.champion_phone || null,
        csm_id: form.csm_id,
        health: {
          churn_risk_score: form.churn_risk_score ? Number(form.churn_risk_score) : null,
          expansion_score: form.expansion_score ? Number(form.expansion_score) : null,
          health_status: form.health_status as "critical" | "at_risk" | "stable" | "healthy" | "expanding",
          crystal_ball_reasoning: form.crystal_ball_reasoning || null,
        },
      });
      setResult(response);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Error al registrar cuenta", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success / Skipped state ──────────────────────────────────────────────
  if (result) {
    const isSuccess = result.inserted;
    return (
      <div className="max-w-xl mx-auto mt-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <SurfaceCard tone={isSuccess ? "emerald" : "amber"} hoverLift={false} motionless className="p-10 text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 280, damping: 22 }}
              className={`w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center ${isSuccess ? "bg-emerald-500/20" : "bg-amber-500/20"}`}
            >
              {isSuccess
                ? <svg {...SVG} width="28" height="28" strokeWidth={3} className="text-emerald-300"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg {...SVG} width="28" height="28" className="text-amber-300"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              }
            </motion.div>
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
              {isSuccess ? t("newAcc.successTitle") : t("newAcc.skippedTitle")}
            </h2>
            <p className="text-sm text-slate-400 mb-1">
              {isSuccess ? t("newAcc.successSub") : t("newAcc.skippedSub")}
            </p>
            {result.account_id && (
              <p className="text-xs text-slate-600 font-mono mt-1">{result.account_id}</p>
            )}
            <div className="flex items-center justify-center gap-3 mt-8">
              <button
                onClick={() => navigate("/")}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {t("newAcc.viewDash")}
              </button>
              <button
                onClick={() => { setResult(null); setForm(INITIAL); }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors"
              >
                {t("newAcc.addAnother")}
              </button>
            </div>
          </SurfaceCard>
        </motion.div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate("/upload")}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors mb-4 flex items-center gap-1.5"
        >
          <svg {...SVG} width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
          {t("newAcc.backToUpload")}
        </button>
        <div className="flex items-center gap-1.5 mb-1">
          <svg {...SVG} className="text-indigo-300">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-300">{t("newAcc.badge")}</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("newAcc.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("newAcc.subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">

        {/* Section 1 – Account */}
        <SurfaceCard weight="panel" tone="indigo" hoverLift={false} motionIndex={0} className="p-6">
          <SectionHeader
            label={t("newAcc.sec1")}
            icon={
              <svg {...SVG} width="15" height="15">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label={fieldLabel("name", t)} error={errors.name} required>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="Nova Analytics"
                  className={inputCls(errors.name)}
                />
              </FormField>
            </div>

            <FormField label={fieldLabel("accountNumber", t)} error={errors.account_number} required>
              <input
                type="text"
                value={form.account_number}
                onChange={e => set("account_number", e.target.value)}
                placeholder="ACC-2026-09999"
                className={inputCls(errors.account_number)}
              />
            </FormField>

            <FormField label={fieldLabel("industry", t)} error={errors.industry} required>
              <Select
                value={form.industry}
                onChange={v => set("industry", v)}
                options={[{ value: "", label: t("newAcc.selectPlaceholder") }, ...ENUM_VALUES.industry!.map(v => ({ value: v, label: v }))]}
                className={errors.industry ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>

            <FormField label={fieldLabel("size", t)} error={errors.size} required>
              <Select
                value={form.size}
                onChange={v => set("size", v)}
                options={[{ value: "", label: t("newAcc.selectPlaceholder") }, ...ENUM_VALUES.size!.map(v => ({ value: v, label: v }))]}
                className={errors.size ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>

            <FormField label={fieldLabel("geography", t)} error={errors.geography} required>
              <Select
                value={form.geography}
                onChange={v => set("geography", v)}
                options={[{ value: "", label: t("newAcc.selectPlaceholder") }, ...ENUM_VALUES.geography!.map(v => ({ value: v, label: v }))]}
                className={errors.geography ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>

            <FormField label={fieldLabel("plan", t)} error={errors.plan} required>
              <Select
                value={form.plan}
                onChange={v => set("plan", v)}
                options={[{ value: "", label: t("newAcc.selectPlaceholder") }, ...ENUM_VALUES.plan!.map(v => ({ value: v, label: v }))]}
                className={errors.plan ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>

            <FormField label={fieldLabel("arrUsd", t)} error={errors.arr_usd} required>
              <input
                type="number"
                min="0"
                value={form.arr_usd}
                onChange={e => set("arr_usd", e.target.value)}
                placeholder="42000"
                className={inputCls(errors.arr_usd)}
              />
            </FormField>

            <FormField label={fieldLabel("seatsPurchased", t)} error={errors.seats_purchased} required>
              <input
                type="number"
                min="0"
                value={form.seats_purchased}
                onChange={e => set("seats_purchased", e.target.value)}
                placeholder="120"
                className={inputCls(errors.seats_purchased)}
              />
            </FormField>

            <FormField label={fieldLabel("seatsActive", t)} error={errors.seats_active} required>
              <input
                type="number"
                min="0"
                value={form.seats_active}
                onChange={e => set("seats_active", e.target.value)}
                placeholder="77"
                className={inputCls(errors.seats_active)}
              />
            </FormField>
          </div>
        </SurfaceCard>

        {/* Section 2 – Dates */}
        <SurfaceCard weight="panel" tone="sky" hoverLift={false} motionIndex={1} className="p-6">
          <SectionHeader
            label={t("newAcc.sec2")}
            icon={
              <svg {...SVG} width="15" height="15">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <FormField label={fieldLabel("signupDate", t)} error={errors.signup_date} required>
              <input
                type="date"
                value={form.signup_date}
                onChange={e => set("signup_date", e.target.value)}
                className={inputCls(errors.signup_date)}
              />
            </FormField>
            <FormField label={fieldLabel("contractRenewalDate", t)} error={errors.contract_renewal_date} required>
              <input
                type="date"
                value={form.contract_renewal_date}
                onChange={e => set("contract_renewal_date", e.target.value)}
                className={inputCls(errors.contract_renewal_date)}
              />
            </FormField>
          </div>
        </SurfaceCard>

        {/* Section 3 – Champion */}
        <SurfaceCard weight="panel" tone="violet" hoverLift={false} motionIndex={2} className="p-6">
          <SectionHeader
            label={t("newAcc.sec3")}
            icon={
              <svg {...SVG} width="15" height="15">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <FormField label={fieldLabel("championName", t)} error={errors.champion_name} required>
              <input
                type="text"
                value={form.champion_name}
                onChange={e => set("champion_name", e.target.value)}
                placeholder="Ana Torres"
                className={inputCls(errors.champion_name)}
              />
            </FormField>

            <FormField label={fieldLabel("championEmail", t)} error={errors.champion_email} required>
              <input
                type="email"
                value={form.champion_email}
                onChange={e => set("champion_email", e.target.value)}
                placeholder="ana@nova.com"
                className={inputCls(errors.champion_email)}
              />
            </FormField>

            <FormField label={fieldLabel("championRole", t)} error={errors.champion_role} required>
              <input
                type="text"
                value={form.champion_role}
                onChange={e => set("champion_role", e.target.value)}
                placeholder="Head of Ops"
                className={inputCls(errors.champion_role)}
              />
            </FormField>

            <FormField label={fieldLabel("championPhone", t)} error={errors.champion_phone}>
              <input
                type="tel"
                value={form.champion_phone}
                onChange={e => set("champion_phone", e.target.value)}
                placeholder="+5215511111111"
                className={inputCls(errors.champion_phone)}
              />
            </FormField>
          </div>
        </SurfaceCard>

        {/* Section 4 – CSM */}
        <SurfaceCard weight="panel" tone="emerald" hoverLift={false} motionIndex={3} className="p-6">
          <SectionHeader
            label={t("newAcc.sec4")}
            icon={
              <svg {...SVG} width="15" height="15">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            }
          />
          {csms.length === 0 ? (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <svg {...SVG} width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {t("newAcc.errNoCsms")}
            </p>
          ) : (
            <FormField label={fieldLabel("csmAssigned", t)} error={errors.csm_id} required>
              <Select
                value={form.csm_id}
                onChange={v => set("csm_id", v)}
                options={[{ value: "", label: t("newAcc.selectPlaceholder") }, ...csms.map(c => ({ value: c.id, label: c.name }))]}
                className={errors.csm_id ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>
          )}
        </SurfaceCard>

        {/* Section 5 – Health (optional) */}
        <SurfaceCard weight="panel" tone="amber" hoverLift={false} motionIndex={4} className="p-6">
          <SectionHeader
            label={t("newAcc.sec5")}
            sub={t("newAcc.sec5Sub")}
            icon={
              <svg {...SVG} width="15" height="15">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <FormField label={fieldLabel("churnRiskScore", t)} error={errors.churn_risk_score} required>
              <input
                type="number"
                min="0"
                max="100"
                value={form.churn_risk_score}
                onChange={e => set("churn_risk_score", e.target.value)}
                placeholder="31"
                className={inputCls(errors.churn_risk_score)}
              />
            </FormField>

            <FormField label={fieldLabel("expansionScore", t)} error={errors.expansion_score} required>
              <input
                type="number"
                min="0"
                max="100"
                value={form.expansion_score}
                onChange={e => set("expansion_score", e.target.value)}
                placeholder="52"
                className={inputCls(errors.expansion_score)}
              />
            </FormField>

            <FormField label={fieldLabel("healthStatus", t)} error={errors.health_status} required>
              <Select
                value={form.health_status}
                onChange={v => set("health_status", v)}
                options={[
                  { value: "", label: t("newAcc.selectPlaceholder") },
                  ...ENUM_VALUES.healthStatus!.map(v => ({
                    value: v,
                    label: t(`status.${v}`),
                    dotClass: HEALTH_DOT[v] ?? "",
                  })),
                ]}
                className={errors.health_status ? "ring-1 ring-rose-500/40 rounded-lg" : ""}
              />
            </FormField>

            <div className="col-span-2">
              <FormField label="Crystal Ball Reasoning" error={errors.crystal_ball_reasoning} required>
                <textarea
                  value={form.crystal_ball_reasoning}
                  onChange={e => set("crystal_ball_reasoning", e.target.value)}
                  placeholder={t("newAcc.crystalPlaceholder")}
                  rows={3}
                  className={`${inputCls(errors.crystal_ball_reasoning)} resize-none`}
                />
              </FormField>
            </div>
          </div>
        </SurfaceCard>

        {/* Submit bar */}
        <div className="flex items-center justify-between py-2">
          <button
            type="button"
            onClick={() => navigate("/upload")}
            className="text-sm font-medium text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t("newAcc.backToUpload")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {t("newAcc.submitting")}
              </>
            ) : (
              <>
                {t("newAcc.submit")}
                <svg {...SVG} width="14" height="14">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
