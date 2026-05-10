// Derived from CONTRACTS.md — keep in sync with API response shapes

export type HealthStatus = "critical" | "at_risk" | "stable" | "healthy" | "expanding";
export type InterventionChannel = "email" | "slack" | "whatsapp" | "voice_call";
export type InterventionOutcome = "success" | "partial" | "no_response" | "negative" | "churned";
export type InterventionStatus =
  | "pending_approval"
  | "rejected"
  | "pending"
  | "sent"
  | "delivered"
  | "opened"
  | "responded"
  | "failed";

export interface Intervention {
  id: string;
  accountId: string;
  accountName: string;
  triggerReason: string;
  channel: InterventionChannel;
  recipient: string;
  messageSubject: string | null;
  messageBody: string;
  agentReasoning: string;
  confidenceScore: number;
  playbookIdUsed: string | null;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  autoApproved: boolean;
  rejectionReason: string | null;
  status: InterventionStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  respondedAt: string | null;
  outcome: InterventionOutcome | null;
  outcomeNotes: string | null;
  outcomeRecordedAt: string | null;
  createdAt: string;
}

export interface InterventionsResponse {
  interventions: Intervention[];
  total: number;
}

export interface CsmRef {
  id: string;
  name: string;
  email: string;
  slackHandle?: string | null;
}

export interface CsmDetail extends CsmRef {
  slackUserId?: string | null;
  phone?: string | null;
  role?: string;
}

export interface AccountSummary {
  id: string;
  /** Identificador comercial único (columna `account_number` en BD). */
  accountNumber?: string | null;
  name: string;
  industry: string;
  size: string;
  plan: string;
  arrUsd: number;
  championName: string;
  csm: CsmRef;
  contractRenewalDate: string;
  healthStatus: HealthStatus;
  churnRiskScore: number;
  expansionScore: number;
  currentNpsScore?: number | null;
  currentNpsCategory?: "detractor" | "passive" | "promoter" | null;
  lastNpsAt?: string | null;
  // Campos extra que solo viven cuando el usuario importa un Excel
  geography?: string;
  seatsPurchased?: number;
  seatsActive?: number;
  signupDate?: string;
  championRole?: string;
  contact?: ContactChannels;
}

export interface ImportAccountRow {
  name: string;
  industry: string;
  size: string;
  geography: string;
  plan: string;
  arr_usd: number;
  seats_purchased: number;
  seats_active: number;
  signup_date: string;
  contract_renewal_date: string;
  champion_name: string;
  champion_email: string;
  champion_role: string;
  csm_assigned: string;
  churn_risk_score?: number | null;
  expansion_score?: number | null;
  health_status?: HealthStatus | null;
  account_number?: string | null;
}

export interface ImportRequest {
  accounts: ImportAccountRow[];
}

export interface ImportError {
  rowIndex: number;
  name: string;
  message: string;
}

export interface ImportResponse {
  inserted: number;
  skipped: number;
  errors: ImportError[];
  insertedIds: string[];
}

export interface AccountsResponse {
  accounts: AccountSummary[];
  total: number;
}

export interface Signal {
  signal: string;
  value: number;
  severity: "low" | "medium" | "high";
}

export interface AccountHealth {
  status: HealthStatus;
  churnRiskScore: number;
  previousChurnRiskScore?: number | null;
  trendDirection?: "improving" | "stable" | "worsening";
  topSignals: Signal[];
  predictedChurnReason: string | null;
  crystalBallReasoning: string;
  expansionScore: number;
  readyToExpand: boolean;
}

export interface Champion {
  name: string;
  email: string;
  role: string;
  changedRecently: boolean;
  // Solo presentes cuando el usuario importa un Excel; el backend no los persiste.
  phone?: string;
  slackContact?: string;
}

export interface NpsDetail {
  currentScore?: number | null;
  currentCategory?: "detractor" | "passive" | "promoter" | null;
  lastSubmittedAt?: string | null;
  lastFeedback?: string | null;
  historyCount?: number;
}

export interface ContactChannels {
  email: string;
  phone: string;
  slackContact: string;
}

export interface AccountDetail {
  id: string;
  accountNumber?: string | null;
  name: string;
  industry: string;
  size: string;
  geography: string;
  plan: string;
  arrUsd: number;
  seatsPurchased: number;
  seatsActive: number;
  signupDate: string;
  contractRenewalDate: string;
  champion: Champion;
  csm: CsmDetail;
  lastQbrDate: string | null;
  nps?: NpsDetail;
  health: AccountHealth;
}

export interface TimelineEvent {
  type: "usage_event" | "ticket" | "conversation";
  subtype: string;
  timestamp: string;
  summary: string;
}

export interface TimelineResponse {
  accountId: string;
  events: TimelineEvent[];
}

export interface AccountHealthHistoryItem {
  id: string;
  accountId: string;
  healthStatus: HealthStatus;
  churnRiskScore: number;
  expansionScore: number;
  topSignals: unknown;
  predictedChurnReason: string | null;
  crystalBallConfidence: number | null;
  computedAt: string;
  computedByVersion: string;
}

export interface AccountHealthHistoryResponse {
  items: AccountHealthHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface InterventionRecommendation {
  /** ID de la fila persistida en `interventions`. Indispensable para dispatch. */
  interventionId: string | null;
  accountId: string;
  triggerReason: string;
  recommendedChannel: InterventionChannel;
  recipient: string;
  messageSubject: string | null;
  messageBody: string;
  playbookIdUsed: string | null;
  playbookSuccessRateAtDecision: number | null;
  agentReasoning: string;
  confidence: number;
  /** Si true + status="pending_approval", el dispatch está bloqueado hasta aprobación humana. */
  requiresApproval: boolean;
  /** "pending" → listo para dispatch. "pending_approval" → esperando humano. */
  status: "pending" | "pending_approval";
  autoApproved: boolean;
  approvalReasoning: string;
}

export interface ChannelDelivery {
  channel: InterventionChannel;
  status: "pending" | "sent" | "delivered" | "failed";
}

/** Sesión live (ej. ConvAI WebSocket) que el dispatch puede inicializar. */
export interface DispatchSession {
  sessionMode?: "convai";
  signedUrl?: string;
}

export interface DispatchResponse extends DispatchSession {
  deliveries: ChannelDelivery[];
}

/** Una entrada de canal en un dispatch multi-canal. */
export interface ChannelDispatchInput {
  channel: InterventionChannel;
  recipient: string;
  messageSubject?: string | null;
}

/** Payload para `POST /dispatch-intervention/multi`. */
export interface MultiDispatchPayload {
  interventionId: string;
  messageBody: string;
  channels: ChannelDispatchInput[];
  /** Campos opcionales de contexto (account / agente) que el backend reusa para Slack. */
  toName?: string;
  accountId?: string;
  accountName?: string;
  accountArr?: number;
  accountIndustry?: string;
  accountPlan?: string;
  triggerReason?: string;
  confidence?: number;
  playbookId?: string;
  playbookSuccessRate?: number | null;
  approvalReasoning?: string;
  agentReasoning?: string;
  autoApproved?: boolean;
  approvalStatus?: string;
}

export interface ChannelDispatchResult {
  channel: InterventionChannel;
  status: "delivered" | "failed";
  error?: string;
  /** voice_call: ConvAI WebSocket signed URL devuelto por ElevenLabs. */
  signedUrl?: string;
}

export interface CreateAccountPayload {
  account_number?: string | null;
  name: string;
  industry: string;
  size: string;
  geography: string;
  plan: string;
  arr_usd: number;
  seats_purchased: number;
  seats_active: number;
  signup_date: string;
  contract_renewal_date: string;
  champion_name: string;
  champion_email: string;
  champion_role: string;
  champion_phone?: string | null;
  csm_id: string;
  health?: {
    churn_risk_score?: number | null;
    expansion_score?: number | null;
    health_status?: HealthStatus | null;
    crystal_ball_reasoning?: string | null;
  };
}

export interface CreateAccountResponse {
  inserted: boolean;
  skipped: boolean;
  account_id: string;
  message: string;
}

export interface MultiDispatchResponse extends DispatchSession {
  interventionId: string;
  results: ChannelDispatchResult[];
  estimatedDeliverySeconds?: number;
}

export interface Playbook {
  id: string;
  name: string;
  accountProfile: Record<string, unknown>;
  signalPattern: Record<string, unknown>;
  recommendedChannel: InterventionChannel;
  messageTemplate: string;
  timesUsed: number;
  timesSucceeded: number;
  successRate: number;
  version: number;
  supersededBy?: string;
  supersedes?: string;
  replacedAt?: string;
}

export interface PlaybooksResponse {
  playbooks: Playbook[];
}
