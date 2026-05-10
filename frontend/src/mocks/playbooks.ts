import type { Playbook, PlaybooksResponse } from "../types";

// Par destacado: P-007 fue superseded por P-018 después de 5 fallas.
const P007_OLD: Playbook = {
  id: "p007-v1-fintech-mid-prechurn",
  name: "P-007 · Email reactivación · Fintech mid-market en pre-churn",
  accountProfile: { industry: ["fintech"], size: ["mid_market"], plan: ["growth", "business"] },
  signalPattern: { logins_drop_pct: 50, tickets_unresolved: 2 },
  recommendedChannel: "email",
  messageTemplate:
    "Hola, vimos que tu uso bajó este mes. ¿Hay algo en lo que podamos ayudarte? Responde este email cuando puedas.",
  timesUsed: 7,
  timesSucceeded: 2,
  successRate: 0.28,
  version: 1,
  supersededBy: "p018-v1-fintech-mid-prechurn",
  replacedAt: "2026-04-12T00:00:00Z",
};

const P018_NEW: Playbook = {
  id: "p018-v1-fintech-mid-prechurn",
  name: "P-018 · Llamada personal · Fintech mid-market en pre-churn",
  accountProfile: { industry: ["fintech"], size: ["mid_market"], plan: ["growth", "business"] },
  signalPattern: { logins_drop_pct: 50, tickets_unresolved: 2, champion_changed: false },
  recommendedChannel: "voice_call",
  messageTemplate:
    "Hola María, soy Carlos de Acme SaaS. Vi que tu equipo enfrentó algunos issues con el módulo de reportes este último mes y quería entender personalmente qué está pasando...",
  timesUsed: 11,
  timesSucceeded: 8,
  successRate: 0.72,
  version: 1,
  supersedes: "p007-v1-fintech-mid-prechurn",
};

const OTHER_PLAYBOOKS: Playbook[] = [
  {
    id: "p012-ecommerce-expansion",
    name: "P-012 · Upsell por capacidad · Ecommerce SMB",
    accountProfile: { industry: ["ecommerce"], size: ["smb"], plan: ["starter", "growth"] },
    signalPattern: { seats_active_pct: 90, logins_growth_pct: 150 },
    recommendedChannel: "email",
    messageTemplate:
      "Tu equipo creció 3x en los últimos 60 días. Tenemos un upgrade a Growth que te da 2x los seats sin tocar el costo de los reportes...",
    timesUsed: 14,
    timesSucceeded: 9,
    successRate: 0.64,
    version: 2,
  },
  {
    id: "p005-healthtech-checkin",
    name: "P-005 · Check-in proactivo · Healthtech baja adopción",
    accountProfile: { industry: ["healthtech"], size: ["mid_market"] },
    signalPattern: { features_used_count: 2, days_since_last_login: 14 },
    recommendedChannel: "slack",
    messageTemplate:
      "Hey equipo 👋 noté que no estás usando el módulo de auditoría. Te mando un loom de 3min mostrando cómo te ahorra 4hrs/semana...",
    timesUsed: 22,
    timesSucceeded: 12,
    successRate: 0.55,
    version: 3,
  },
  {
    id: "p022-latam-champion-change",
    name: "P-022 · Onboarding de nuevo champion · LATAM",
    accountProfile: { geography: ["latam"], size: ["mid_market", "enterprise"] },
    signalPattern: { champion_changed: true, days_since_change: 30 },
    recommendedChannel: "whatsapp",
    messageTemplate:
      "Hola! Vi que ahora estás liderando la cuenta. ¿Te parece si te mando los 3 dashboards más usados por tu equipo y agendamos un onboarding de 30min?",
    timesUsed: 9,
    timesSucceeded: 7,
    successRate: 0.78,
    version: 1,
  },
  {
    id: "p030-enterprise-renewal",
    name: "P-030 · Llamada ejecutiva · Enterprise pre-renewal",
    accountProfile: { size: ["enterprise"] },
    signalPattern: { days_to_renewal: 60, churn_risk_score: 60 },
    recommendedChannel: "voice_call",
    messageTemplate:
      "Hola, soy [VP CS]. La renovación se acerca y quiero asegurar que estamos cubriendo lo que necesitas para el próximo año fiscal...",
    timesUsed: 10,
    timesSucceeded: 9,
    successRate: 0.9,
    version: 2,
  },
  {
    id: "p015-edtech-startup-upsell",
    name: "P-015 · Email upsell · Edtech startup",
    accountProfile: { industry: ["edtech"], size: ["startup"] },
    signalPattern: { seats_active_pct: 85, plan: "starter" },
    recommendedChannel: "email",
    messageTemplate:
      "Notamos que estás cerca del límite de seats del plan starter. Te dejo opciones para hacer upgrade sin downtime...",
    timesUsed: 12,
    timesSucceeded: 5,
    successRate: 0.42,
    version: 1,
  },
  {
    id: "p009-onboarding-nudge",
    name: "P-009 · Nudge de feature core · Plan growth nuevo",
    accountProfile: { plan: ["growth"], days_since_signup: [0, 30] },
    signalPattern: { features_used_count: 1 },
    recommendedChannel: "slack",
    messageTemplate:
      "Hey 👋 vi que aún no probaste el módulo X. Te mando 2 plantillas que el 80% de los clientes nuevos usan en su primera semana...",
    timesUsed: 28,
    timesSucceeded: 18,
    successRate: 0.64,
    version: 2,
  },
];

export const mockPlaybooks: Playbook[] = [P018_NEW, ...OTHER_PLAYBOOKS, P007_OLD];

export const mockPlaybooksResponse: PlaybooksResponse = {
  playbooks: mockPlaybooks,
};

export const featuredEvolution = {
  before: P007_OLD,
  after: P018_NEW,
  insight:
    "Después de 5 fallas seguidas con email genérico, el agente notó que en cuentas fintech mid-market con caída de uso > 50% el champion casi siempre era nuevo (< 90 días en el rol). Cambió a llamada personal para crear contexto humano. La tasa subió de 28% a 72%.",
  triggerEvent: "5 fallas consecutivas",
};
