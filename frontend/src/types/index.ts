// Derived from CONTRACTS.md — keep in sync with API response shapes

export type HealthStatus = "critical" | "at_risk" | "stable" | "healthy" | "expanding";
export type InterventionChannel = "email" | "slack" | "whatsapp" | "voice_call";
export type InterventionOutcome = "success" | "partial" | "no_response" | "negative" | "churned";

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
  // Contacto del champion — se llena cuando el usuario importa un Excel
  contact?: ContactChannels;
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

export interface InterventionRecommendation {
  accountId: string;
  triggerReason: string;
  recommendedChannel: InterventionChannel;
  recipient: string;
  messageSubject: string | null;
  messageBody: string;
  playbookIdUsed: string;
  playbookSuccessRateAtDecision: number;
  agentReasoning: string;
  confidence: number;
}

export interface DispatchPayload {
  interventionId?: string;
  channel: InterventionChannel;
  recipient: string;
  messageBody: string;
  messageSubject?: string;
}

export interface ChannelDelivery {
  channel: InterventionChannel;
  status: "pending" | "sent" | "delivered" | "failed";
}

export interface DispatchResponse {
  dispatched: boolean;
  channels: ChannelDelivery[];
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
