import type { InterventionStatus } from "../types";

/** Non-terminal intervention lifecycle states — blocks creating a new intervention (CONTRACTS.md). */
export const OPEN_INTERVENTION_STATUSES = [
  "pending_approval",
  "pending",
  "sent",
  "delivered",
  "opened",
  "responded",
] as const satisfies readonly InterventionStatus[];

export function isOpenInterventionStatus(status: InterventionStatus): boolean {
  return (OPEN_INTERVENTION_STATUSES as readonly string[]).includes(status);
}
