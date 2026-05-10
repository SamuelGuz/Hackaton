"""Dispatch endpoint (CONTRACTS.md) — entrega la intervención por todos los canales."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(tags=["dispatch"])

InterventionChannel = Literal["email", "slack", "whatsapp", "voice_call"]
DeliveryStatus = Literal["pending", "sent", "delivered", "failed"]

_ALL_CHANNELS: list[InterventionChannel] = ["email", "slack", "whatsapp", "voice_call"]


class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    intervention_id: str | None = None
    channel: InterventionChannel = "email"
    recipient: str = Field(default="", max_length=500)
    message_body: str = Field(default="", max_length=10_000)
    message_subject: str | None = None


class ChannelDelivery(BaseModel):
    channel: InterventionChannel
    status: DeliveryStatus


class DispatchResponse(BaseModel):
    dispatched: bool
    channels: list[ChannelDelivery]


@router.post("/dispatch-intervention", response_model=DispatchResponse)
def post_dispatch_intervention(payload: DispatchRequest) -> DispatchResponse:
    """
    Simula el envío de la intervención por todos los canales.
    El canal recomendado se marca 'delivered'; el resto también se intenta.
    """
    channels: list[ChannelDelivery] = [
        ChannelDelivery(channel=ch, status="delivered") for ch in _ALL_CHANNELS
    ]
    return DispatchResponse(dispatched=True, channels=channels)
