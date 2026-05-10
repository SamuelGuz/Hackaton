import { apiFetch, USE_MOCK } from "./client";
import type {
  ChannelDelivery,
  ChannelDispatchResult,
  DispatchResponse,
  InterventionChannel,
  MultiDispatchPayload,
  MultiDispatchResponse,
} from "../types";

export type DeliveryListener = (deliveries: ChannelDelivery[]) => void;

// Tiempos de entrega simulados (ms) — sólo para el modo mock; escalonados para
// que la UI sienta "real-time" durante demos sin backend.
const MOCK_TIMING: Record<InterventionChannel, number> = {
  email:      900,
  slack:      1500,
  whatsapp:   2400,
  voice_call: 3800,
};

/**
 * Despacha la intervención por uno o varios canales en una sola request.
 * `deliveries` y la sesión live (signedUrl) sólo cubren los canales seleccionados.
 */
export async function dispatchInterventionMulti(
  payload: MultiDispatchPayload,
  onProgress?: DeliveryListener
): Promise<DispatchResponse> {
  const selectedChannels = payload.channels.map((c) => c.channel);
  if (USE_MOCK) {
    const deliveries: ChannelDelivery[] = selectedChannels.map((channel) => ({
      channel,
      status: "pending",
    }));
    onProgress?.([...deliveries]);

    deliveries.forEach((d) => (d.status = "sent"));
    onProgress?.([...deliveries]);

    await Promise.all(
      selectedChannels.map(
        (channel) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              const idx = deliveries.findIndex((d) => d.channel === channel);
              deliveries[idx] = { channel, status: "delivered" };
              onProgress?.([...deliveries]);
              resolve();
            }, MOCK_TIMING[channel]);
          })
      )
    );

    const includesVoice = selectedChannels.includes("voice_call");
    return {
      deliveries,
      sessionMode: includesVoice ? "convai" : undefined,
      signedUrl: includesVoice
        ? "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=demo&conversation_signature=mock"
        : undefined,
    };
  }

  // Pre-marcamos todos los canales seleccionados como "sent" mientras corre la request.
  const pending: ChannelDelivery[] = selectedChannels.map((channel) => ({
    channel,
    status: "sent",
  }));
  onProgress?.([...pending]);

  const channelsBody = payload.channels.map((c) => ({
    channel: c.channel,
    recipient: c.recipient,
    message_subject: c.messageSubject ?? null,
  }));

  const res = await apiFetch<{
    intervention_id: string;
    results: Array<{
      channel: InterventionChannel;
      status: "delivered" | "failed";
      error?: string;
      signed_url?: string;
    }>;
    session_mode?: "convai";
    signed_url?: string;
    estimated_delivery_seconds?: number;
  }>("/dispatch-intervention/multi", {
    method: "POST",
    body: JSON.stringify({
      intervention_id: payload.interventionId,
      message_body: payload.messageBody,
      channels: channelsBody,
      to_name: payload.toName,
      account_id: payload.accountId,
      account_name: payload.accountName,
      account_arr: payload.accountArr,
      account_industry: payload.accountIndustry,
      account_plan: payload.accountPlan,
      trigger_reason: payload.triggerReason,
      confidence: payload.confidence,
      playbook_id: payload.playbookId,
      playbook_success_rate: payload.playbookSuccessRate,
      approval_reasoning: payload.approvalReasoning,
      agent_reasoning: payload.agentReasoning,
      auto_approved: payload.autoApproved,
      approval_status: payload.approvalStatus,
    }),
  });

  // apiFetch ya hizo camelCase: results[].channel/status/error/signedUrl, session_mode → sessionMode, etc.
  const camel = res as unknown as MultiDispatchResponse;

  const resultMap = new Map<InterventionChannel, ChannelDispatchResult>();
  (camel.results ?? []).forEach((r) => resultMap.set(r.channel, r));

  const deliveries: ChannelDelivery[] = selectedChannels.map((channel) => {
    const r = resultMap.get(channel);
    return {
      channel,
      status: r?.status === "delivered" ? "delivered" : r?.status === "failed" ? "failed" : "sent",
    };
  });
  onProgress?.([...deliveries]);

  // Si todos fallaron, levantamos error con el primer mensaje útil.
  const allFailed = deliveries.every((d) => d.status === "failed");
  if (allFailed) {
    const firstErr = (camel.results ?? []).find((r) => r.error)?.error;
    throw new Error(firstErr || "dispatch_failed");
  }

  // Si voice_call está y vino signedUrl en el resultado por canal, lo preferimos al top-level.
  const voiceResult = resultMap.get("voice_call");
  const signedUrl = voiceResult?.signedUrl ?? camel.signedUrl;

  return {
    deliveries,
    sessionMode: signedUrl ? "convai" : camel.sessionMode,
    signedUrl,
  };
}
