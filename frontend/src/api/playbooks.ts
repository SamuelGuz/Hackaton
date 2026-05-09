import { apiFetch, USE_MOCK } from "./client";
import { mockPlaybooksResponse, featuredEvolution } from "../mocks/playbooks";
import type { PlaybooksResponse, Playbook } from "../types";

export interface FeaturedEvolution {
  before: Playbook;
  after: Playbook;
  insight: string;
  triggerEvent: string;
}

export async function getPlaybooks(): Promise<PlaybooksResponse> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200));
    return mockPlaybooksResponse;
  }
  return apiFetch<PlaybooksResponse>("/playbooks");
}

export async function getFeaturedEvolution(): Promise<FeaturedEvolution | null> {
  if (USE_MOCK) return featuredEvolution;
  // Requiere en DB al menos un playbook nuevo con `supersedes` → fila antigua con superseded_by = id del nuevo.
  const { playbooks } = await apiFetch<PlaybooksResponse>("/playbooks");
  const after = playbooks.find((p) => p.supersedes);
  const before = after && playbooks.find((p) => p.id === after.supersedes);
  if (!before || !after) return null;
  return {
    before,
    after,
    insight: "El agente reemplazó este playbook tras una racha de fallas.",
    triggerEvent: "Bajo desempeño detectado",
  };
}
