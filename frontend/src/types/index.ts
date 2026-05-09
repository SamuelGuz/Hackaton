// Derived from CONTRACTS.md — keep in sync with API response shapes

export type HealthStatus = "critical" | "at_risk" | "stable" | "healthy" | "expanding";
export type InterventionChannel = "email" | "slack" | "whatsapp" | "voice_call";
export type InterventionOutcome = "success" | "partial" | "no_response" | "negative" | "churned";

export interface AccountSummary {
  id: string;
  name: string;
  industry: string;
  size: string;
  plan: string;
  arrUsd: number;
  championName: string;
  csmAssigned: string;
  contractRenewalDate: string;
  healthStatus: HealthStatus;
  churnRiskScore: number;
  expansionScore: number;
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
  topSignals: Signal[];
  predictedChurnReason: string;
  crystalBallReasoning: string;
  expansionScore: number;
  readyToExpand: boolean;
}

export interface Champion {
  name: string;
  email: string;
  role: string;
  changedRecently: boolean;
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
  csmAssigned: string;
  lastQbrDate: string | null;
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
