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

  const res = await apiFetch<{ dispatched: boolean; channels: ChannelDelivery[] }>(
    "/dispatch-intervention",
    {
      method: "POST",
      body: JSON.stringify({
        intervention_id: payload.interventionId,
        channel: payload.channel,
        recipient: payload.recipient,
        message_body: payload.messageBody,
        message_subject: payload.messageSubject,
      }),
    }
  );
  return res.channels;
}
