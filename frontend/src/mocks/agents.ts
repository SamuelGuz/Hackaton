import type { InterventionRecommendation } from "../types";

// Recomendación de intervención para Acme Corp (cuenta crítica, churn risk 91)
export const mockInterventionAcme: InterventionRecommendation = {
  interventionId: "mock-inv-acme-0001",
  accountId: "a1b2c3d4-0001-0000-0000-000000000001",
  triggerReason: "churn_risk_high",
  recommendedChannel: "voice_call",
  recipient: "+57 300 1234567",
  messageSubject: null,
  messageBody:
    "Hola María, soy Carlos de Acme SaaS. Vi que tu equipo enfrentó algunos issues con el módulo de reportes este último mes y quería entender personalmente qué está pasando. Tenemos algunas opciones para resolver lo de la integración con tu ERP esta misma semana, sin costo adicional. ¿Te parece si charlamos 15 minutos mañana?",
  playbookIdUsed: "p007-fintech-mid-pre-churn",
  playbookSuccessRateAtDecision: 0.72,
  agentReasoning:
    "Para cuentas fintech mid-market con caída de logins >60% + tickets críticos sin resolver, el playbook P-007 ha tenido 72% de éxito en las últimas 11 ejecuciones. Una llamada personal supera por 3x al email en este perfil porque el champion (María) lleva solo 2 meses en el rol y necesita contexto humano, no más threads. El mensaje menciona explícitamente el dolor (módulo de reportes + ERP) sin alarmar.",
  confidence: 0.81,
  requiresApproval: false,
  status: "pending",
  autoApproved: true,
  approvalReasoning: "Mock auto-aprobada para demo.",
};

export function getMockIntervention(accountId: string): InterventionRecommendation {
  return { ...mockInterventionAcme, accountId };
}
