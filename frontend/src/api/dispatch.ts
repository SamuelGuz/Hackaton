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
 * `deliveries` y los metadatos de sesión de voz sólo cubren los canales seleccionados.
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
      sessionMode: includesVoice ? "twilio_pstn" : undefined,
      callSid: includesVoice ? "CA_mock_call_sid" : undefined,
      toPhone:
        includesVoice
          ? payload.channels.find((c) => c.channel === "voice_call")?.recipient
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
      call_sid?: string;
      to_phone?: string;
    }>;
    session_mode?: "twilio_pstn";
    call_sid?: string;
    to_phone?: string;
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

  // apiFetch ya hizo camelCase: session_mode->sessionMode, call_sid->callSid, etc.
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

  // Si voice_call está y vino callSid en el resultado por canal, lo preferimos al top-level.
  const voiceResult = resultMap.get("voice_call");
  const callSid = voiceResult?.callSid ?? camel.callSid;
  const toPhone = voiceResult?.toPhone ?? camel.toPhone;

  return {
    deliveries,
    sessionMode: callSid ? "twilio_pstn" : camel.sessionMode,
    callSid,
    toPhone,
  };
}
