import type { InterventionChannel } from "../types";

const SVG_PROPS = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export const channelLabel: Record<InterventionChannel, string> = {
  email: "Email",
  slack: "Slack",
  whatsapp: "WhatsApp",
  voice_call: "Llamada de voz",
};

export function ChannelIcon({ channel }: { channel: InterventionChannel }) {
  switch (channel) {
    case "email":
      return (
        <svg {...SVG_PROPS}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "slack":
      return (
        <svg {...SVG_PROPS}>
          <rect x="13" y="2" width="3" height="8" rx="1.5" />
          <rect x="8" y="14" width="3" height="8" rx="1.5" />
          <rect x="2" y="13" width="8" height="3" rx="1.5" />
          <rect x="14" y="8" width="8" height="3" rx="1.5" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...SVG_PROPS}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case "voice_call":
      return (
        <svg {...SVG_PROPS}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
  }
}
