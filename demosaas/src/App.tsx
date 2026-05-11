import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { customerAccount } from "./config/customerAccount";
import {
  ApiError,
  applyAccountDetailForImports,
  type DemosaasAccountDetail,
  fetchAccountDetail,
  fetchAccountTimeline,
  importConversation,
  importTicket,
  importUsageEvent,
} from "./lib/api";
import {
  buildWelcomeMessage,
  timelineRowsToChat,
  timelineRowsToTickets,
  type UiChatMsg,
  type UiTicketRow,
} from "./lib/timelineToUi";

/* ─── types ────────────────────────────────────────────────────── */

type Tab = "inicio" | "herramientas" | "soporte" | "mensajes";

type Toast = { id: string; kind: "ok" | "err"; text: string };

type ModuleCard = {
  id: string;
  icon: string;
  name: string;
  description: string;
  feature: string;
  state: "idle" | "opening" | "open";
};

type TicketRow = UiTicketRow;
type ChatMsg = UiChatMsg;

/* ─── mock data ─────────────────────────────────────────────────── */

const INITIAL_MODULES: ModuleCard[] = [
  {
    id: "forecast",
    icon: "📈",
    name: "Forecast Dashboard",
    description: "Proyecta ingresos y cierre de pipeline para el trimestre.",
    feature: "forecast_dashboard",
    state: "idle",
  },
  {
    id: "pipeline",
    icon: "🔀",
    name: "Pipeline Analytics",
    description: "Analiza etapas de venta y cuellos de botella en tiempo real.",
    feature: "pipeline_analytics",
    state: "idle",
  },
  {
    id: "revenue",
    icon: "💰",
    name: "Revenue Intelligence",
    description: "Patrones de expansión, renovación y riesgo de contrato.",
    feature: "revenue_intelligence",
    state: "idle",
  },
  {
    id: "reports",
    icon: "📄",
    name: "Reportes Ejecutivos",
    description: "Genera reportes PDF o exportables para dirección.",
    feature: "executive_reports",
    state: "idle",
  },
];

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

/* ─── helpers ───────────────────────────────────────────────────── */

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function timeNow() {
  return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/* ─── component ─────────────────────────────────────────────────── */

function initialsFromName(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  if (p.length === 1 && p[0].length >= 2) return p[0].slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [companyName, setCompanyName] = useState(() => customerAccount.name);
  const [accountDetail, setAccountDetail] = useState<DemosaasAccountDetail | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modules, setModules] = useState<ModuleCard[]>(INITIAL_MODULES);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [newSubject, setNewSubject] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingAccount(true);
    setAccountError(null);
    setTickets([]);
    setChat([]);
    setCompanyName(customerAccount.name);
    (async () => {
      try {
        const detail = await fetchAccountDetail(customerAccount.id);
        if (cancelled) return;
        setAccountDetail(detail);
        applyAccountDetailForImports(detail);
        if (detail.name.trim()) setCompanyName(detail.name.trim());

        const tl = await fetchAccountTimeline(detail.id);
        if (cancelled) return;
        setTickets(timelineRowsToTickets(tl.events));
        const convMsgs = timelineRowsToChat(tl.events);
        if (convMsgs.length > 0) {
          setChat(convMsgs);
        } else if (detail.name.trim() && detail.csm.name) {
          setChat([buildWelcomeMessage(detail.name.trim(), detail.csm.name)]);
        } else {
          setChat([]);
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as ApiError;
        setAccountError(e.message || "No se pudo cargar la cuenta.");
        setAccountDetail(null);
      } finally {
        if (!cancelled) setLoadingAccount(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerAccount.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const toast = useCallback((kind: "ok" | "err", text: string) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  async function handleOpenModule(mod: ModuleCard) {
    if (mod.state !== "idle") return;
    const userEmail = accountDetail?.champion.email?.trim();
    if (!userEmail) {
      toast("err", "Espera a que cargue la cuenta o revisa que el champion tenga email en la API.");
      return;
    }
    setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, state: "opening" } : m)));
    try {
      await importUsageEvent(mod.feature, userEmail);
      setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, state: "open" } : m)));
    } catch (err) {
      const e = err as ApiError;
      setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, state: "idle" } : m)));
      toast("err", e.message || "No se pudo abrir el módulo.");
    }
  }

  async function handleSubmitTicket(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    const subject = newSubject.trim();
    const description = newDesc.trim();
    try {
      await importTicket({ subject, description, priority: newPriority });
      const row: TicketRow = {
        id: `T-${String(Date.now()).slice(-4)}`,
        subject,
        priority: newPriority,
        status: "open",
        date: new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
      };
      setTickets((prev) => [row, ...prev]);
      setNewSubject("");
      setNewDesc("");
      setNewPriority("medium");
      toast("ok", "Solicitud enviada. Te responderemos pronto.");
    } catch (err) {
      const e = err as ApiError;
      toast("err", e.message || "No se pudo enviar la solicitud.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    const csmEmail = accountDetail?.csm.email?.trim();
    const champEmail = accountDetail?.champion.email?.trim();
    if (!csmEmail) {
      toast("err", "Falta el email del CSM en la cuenta.");
      return;
    }
    const participants =
      champEmail && champEmail !== csmEmail ? [csmEmail, champEmail] : [csmEmail, csmEmail];
    setSending(true);
    const optimistic: ChatMsg = {
      id: uid(),
      from: "me",
      text,
      time: timeNow(),
      source: "local",
    };
    setChat((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      await importConversation({
        content: text,
        participants,
        direction: "outbound",
      });
    } catch (err) {
      const e = err as ApiError;
      toast("err", e.message || "El mensaje no se pudo entregar.");
    } finally {
      setSending(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "inicio", label: "Inicio" },
    { id: "herramientas", label: "Herramientas" },
    { id: "soporte", label: "Soporte" },
    { id: "mensajes", label: "Mensajes" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#06080f] text-slate-100">
      {/* top bar */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-[#070a14]/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
            DS
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">DemoSaaS Ops</span>
          <span className="hidden rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-400 sm:inline">
            {companyName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Notificaciones"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 sm:inline">Operaciones</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-700/60 text-xs font-semibold text-indigo-100">
              OP
            </span>
          </div>
        </div>
      </header>

      {/* tabs */}
      <nav className="flex gap-0.5 border-b border-slate-800 bg-[#070a14]/70 px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-3 text-sm transition-colors ${
              tab === t.id
                ? "border-indigo-500 font-medium text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 md:p-6">
        {loadingAccount ? (
          <div className="mx-auto max-w-lg py-20 text-center text-sm text-slate-400">
            Cargando datos de la cuenta…
          </div>
        ) : (
          <>
            {accountError ? (
              <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-amber-500/30 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
                {accountError} — Revisa <code className="text-amber-200">demo_saas_VITE_ACCOUNT_ID</code> y la
                API.
              </div>
            ) : null}
            {tab === "inicio" && (
              <TabInicio companyName={companyName} accountDetail={accountDetail} />
            )}
            {tab === "herramientas" && (
              <TabHerramientas modules={modules} onOpen={handleOpenModule} />
            )}
            {tab === "soporte" && (
              <TabSoporte
                tickets={tickets}
                subject={newSubject}
                desc={newDesc}
                priority={newPriority}
                sending={sending}
                onSubject={setNewSubject}
                onDesc={setNewDesc}
                onPriority={setNewPriority}
                onSubmit={handleSubmitTicket}
              />
            )}
            {tab === "mensajes" && (
              <TabMensajes
                chat={chat}
                draft={draft}
                sending={sending}
                onDraft={setDraft}
                onSend={handleSendMessage}
                chatEndRef={chatEndRef}
                csmName={accountDetail?.csm.name ?? customerAccount.csmName}
                csmInitials={initialsFromName(accountDetail?.csm.name ?? customerAccount.csmName)}
                canSend={Boolean(accountDetail?.csm.email)}
              />
            )}
          </>
        )}
      </main>

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-5 right-5 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-in pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-xl ${
              t.kind === "ok"
                ? "border border-emerald-600/30 bg-emerald-900/80 text-emerald-100"
                : "border border-rose-600/30 bg-rose-900/80 text-rose-100"
            }`}
          >
            {t.kind === "ok" ? "✓ " : "✕ "}
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Inicio ────────────────────────────────────────────────────── */

function TabInicio({
  companyName,
  accountDetail,
}: {
  companyName: string;
  accountDetail: DemosaasAccountDetail | null;
}) {
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      n || 0
    );

  const kpis = accountDetail
    ? [
        {
          label: "Licencias (activas / contratadas)",
          value: `${accountDetail.seats_active} / ${accountDetail.seats_purchased}`,
          sub: "Según registro de la cuenta",
        },
        {
          label: "ARR (USD)",
          value: fmtMoney(accountDetail.arr_usd),
          sub: `Plan: ${accountDetail.plan}`,
        },
        {
          label: "Champion en cuenta",
          value: accountDetail.champion.name || "—",
          sub: accountDetail.champion.email || "Sin email",
        },
      ]
    : [
        { label: "Licencias", value: "—", sub: "Carga la cuenta" },
        { label: "ARR", value: "—", sub: "—" },
        { label: "Segmento", value: "—", sub: "—" },
      ];

  const csmLine = accountDetail
    ? `CSM: ${accountDetail.csm.name}`
    : `CSM: ${customerAccount.csmName}`;
  const segmentLine = accountDetail
    ? `${accountDetail.industry} · ${accountDetail.geography}`
    : customerAccount.segmentLabel;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Bienvenido, equipo {companyName}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {segmentLine} · {csmLine}
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{k.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <h2 className="text-sm font-semibold text-slate-200">Novedades del producto</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-indigo-400">•</span>
            <span>
              <strong className="text-slate-200">Forecast v2.4</strong> — nueva vista de escenarios
              pesimista / optimista disponible.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-indigo-400">•</span>
            <span>
              <strong className="text-slate-200">Exportación XLSX</strong> — ahora con soporte de
              múltiples hojas por reporte.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-indigo-400">•</span>
            <span>
              <strong className="text-slate-200">Mejoras de velocidad</strong> — carga de pipeline
              hasta 40 % más rápida.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ─── Herramientas ──────────────────────────────────────────────── */

function TabHerramientas({
  modules,
  onOpen,
}: {
  modules: ModuleCard[];
  onOpen: (m: ModuleCard) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Herramientas</h1>
        <p className="mt-1 text-sm text-slate-400">Módulos disponibles en tu plan.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((mod) => (
          <ModCard key={mod.id} mod={mod} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function ModCard({ mod, onOpen }: { mod: ModuleCard; onOpen: (m: ModuleCard) => void }) {
  const isOpen = mod.state === "open";
  const isOpening = mod.state === "opening";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-5 transition-colors ${
        isOpen
          ? "border-indigo-500/40 bg-indigo-950/30"
          : "border-slate-800 bg-slate-900/35 hover:border-slate-700"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="text-2xl">{mod.icon}</span>
        <div>
          <p className="font-semibold text-white">{mod.name}</p>
          {isOpen && (
            <span className="text-xs font-medium text-indigo-400">● Activo ahora</span>
          )}
        </div>
      </div>
      <p className="mb-4 text-sm text-slate-400">{mod.description}</p>
      <button
        type="button"
        onClick={() => onOpen(mod)}
        disabled={isOpening}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          isOpen
            ? "border border-indigo-500/40 bg-transparent text-indigo-300 hover:bg-indigo-500/10"
            : isOpening
              ? "cursor-wait bg-slate-700 text-slate-400"
              : "bg-indigo-600 text-white hover:bg-indigo-500"
        }`}
      >
        {isOpen ? "Volver al módulo" : isOpening ? "Abriendo…" : "Abrir módulo"}
      </button>
    </div>
  );
}

/* ─── Soporte ───────────────────────────────────────────────────── */

function TabSoporte({
  tickets,
  subject,
  desc,
  priority,
  sending,
  onSubject,
  onDesc,
  onPriority,
  onSubmit,
}: {
  tickets: TicketRow[];
  subject: string;
  desc: string;
  priority: "low" | "medium" | "high";
  sending: boolean;
  onSubject: (v: string) => void;
  onDesc: (v: string) => void;
  onPriority: (v: "low" | "medium" | "high") => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const priColors: Record<string, string> = {
    high: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    low: "border-slate-600 bg-slate-800/40 text-slate-400",
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Soporte</h1>
        <p className="mt-1 text-sm text-slate-400">
          ¿Tienes algún problema? Abre una solicitud y te respondemos en menos de 24 h.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/35 p-5 lg:col-span-3"
        >
          <h2 className="font-semibold text-white">Nueva solicitud</h2>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300" htmlFor="ticket-subject">
              Asunto
            </label>
            <input
              id="ticket-subject"
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="Describe brevemente el problema"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300" htmlFor="ticket-desc">
              Descripción
            </label>
            <textarea
              id="ticket-desc"
              value={desc}
              onChange={(e) => onDesc(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="Cuéntanos qué pasó, cuándo y cómo lo podemos reproducir"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300" htmlFor="ticket-priority">
              Urgencia
            </label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => onPriority(e.target.value as "low" | "medium" | "high")}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
            >
              <option value="low">Baja — no bloquea operaciones</option>
              <option value="medium">Media — limita algunas funciones</option>
              <option value="high">Alta — impacto en producción</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={sending}
            className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${
              sending ? "cursor-wait bg-indigo-700/60" : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {sending ? "Enviando…" : "Enviar solicitud"}
          </button>
        </form>

        <div className="lg:col-span-2">
          <h2 className="mb-3 font-semibold text-white">Mis solicitudes</h2>
          <p className="mb-3 text-xs text-slate-500">
            Lista desde el timeline de la cuenta en la API (misma que{" "}
            <code className="text-slate-400">demo_saas_VITE_ACCOUNT_ID</code>).
          </p>
          <ul className="space-y-2">
            {tickets.length === 0 ? (
              <li className="rounded-xl border border-slate-800/80 bg-slate-950/30 px-4 py-6 text-center text-sm text-slate-500">
                No hay tickets registrados para esta cuenta.
              </li>
            ) : null}
            {tickets.map((t) => (
              <li
                key={t.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{t.id}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${priColors[t.priority]}`}
                  >
                    {PRIORITY_LABELS[t.priority]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-200">{t.subject}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span>{t.date}</span>
                  <span>·</span>
                  <span
                    className={t.status === "open" ? "text-amber-400" : "text-emerald-400"}
                  >
                    {t.status === "open" ? "Abierto" : "Cerrado"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ─── Mensajes ──────────────────────────────────────────────────── */

function TabMensajes({
  chat,
  draft,
  sending,
  onDraft,
  onSend,
  chatEndRef,
  csmName,
  csmInitials,
  canSend,
}: {
  chat: ChatMsg[];
  draft: string;
  sending: boolean;
  onDraft: (v: string) => void;
  onSend: (e: FormEvent) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  csmName: string;
  csmInitials: string;
  canSend: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={{ height: "calc(100vh - 138px)" }}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-700/50 text-sm font-semibold text-indigo-200">
          {csmInitials}
        </span>
        <div>
          <p className="text-sm font-semibold text-white">{csmName}</p>
          <p className="text-xs text-slate-400">Customer Success Manager · DemoSaaS Ops</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          En línea
        </span>
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="space-y-3">
          {chat.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No hay conversaciones para esta cuenta en la API.
            </p>
          ) : null}
          {chat.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.from === "me"
                    ? "rounded-br-sm bg-indigo-600 text-white"
                    : "rounded-bl-sm border border-slate-700 bg-slate-800 text-slate-200"
                }`}
              >
                <p className="leading-relaxed">{msg.text}</p>
                <p
                  className={`mt-1 text-right text-[10px] ${
                    msg.from === "me" ? "text-indigo-200/70" : "text-slate-500"
                  }`}
                >
                  {msg.time}
                </p>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      <form onSubmit={onSend} className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
          placeholder={canSend ? "Escribe un mensaje…" : "Cargando cuenta…"}
          disabled={sending || !canSend}
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || !canSend}
          className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
          aria-label="Enviar"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
