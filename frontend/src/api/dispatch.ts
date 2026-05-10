import { apiFetch, USE_MOCK } from "./client";
import type { ChannelDelivery, DispatchPayload, InterventionChannel } from "../types";

export type DeliveryListener = (deliveries: ChannelDelivery[]) => void;

const ALL_CHANNELS: InterventionChannel[] = ["email", "slack", "whatsapp", "voice_call"];

// Tiempos de entrega simulados (ms) — escalonados para sentir "real-time"
const MOCK_TIMING: Record<InterventionChannel, number> = {
  email:      900,
  slack:      1500,
  whatsapp:   2400,
  voice_call: 3800,
};

export async function dispatchIntervention(
  payload: DispatchPayload,
  onProgress?: DeliveryListener
): Promise<ChannelDelivery[]> {
  if (USE_MOCK) {
    // Simulamos los 4 canales aunque solo se haya pedido uno (es el wow del demo)
    const deliveries: ChannelDelivery[] = ALL_CHANNELS.map((channel) => ({
      channel,
      status: "pending",
    }));
    onProgress?.(deliveries);

    // Marcar "sending" inmediatamente
    deliveries.forEach((d) => (d.status = "sent"));
    onProgress?.([...deliveries]);

    // Entregas escalonadas
    await Promise.all(
      ALL_CHANNELS.map(
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

    return deliveries;
  }

  // El backend solo despacha un canal a la vez y devuelve { intervention_id, status, channel, ... }
  // Mostramos los 4 canales: el elegido en estado real + los demás como "no aplica" (queued).
  const initial: ChannelDelivery[] = ALL_CHANNELS.map((channel) => ({
    channel,
    status: channel === payload.channel ? "sent" : "pending",
  }));
  onProgress?.([...initial]);

  const res = await apiFetch<{
    intervention_id?: string;
    status: "dispatched" | "sent" | "delivered" | "failed";
    channel: InterventionChannel;
    error?: string;
  }>("/dispatch-intervention", {
    method: "POST",
    body: JSON.stringify({
      intervention_id: payload.interventionId,
      channel: payload.channel,
      recipient: payload.recipient,
      message_body: payload.messageBody,
      message_subject: payload.messageSubject,
    }),
  });

  // Mapear el resultado del backend al estado UI del canal elegido.
  const finalStatus: ChannelDelivery["status"] =
    res.status === "failed"     ? "failed"
    : res.status === "delivered" ? "delivered"
    : "delivered"; // "sent"/"dispatched" → consideramos entregado para el demo

  const final: ChannelDelivery[] = ALL_CHANNELS.map((channel) => ({
    channel,
    status: channel === payload.channel ? finalStatus : "pending",
  }));
  onProgress?.([...final]);

  if (res.status === "failed") {
    throw new Error(res.error || "dispatch_failed");
  }
  return final;
}
