import type { TimelineEventRow } from "./api";

export type UiTicketRow = {
  id: string;
  subject: string;
  priority: "low" | "medium" | "high";
  status: "open" | "closed";
  date: string;
};

export type UiChatMsg = {
  id: string;
  from: "me" | "csm";
  text: string;
  time: string;
  source: "timeline" | "local";
};

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseTicketSubject(summary: string, kind: "opened" | "resolved"): string {
  if (kind === "opened") {
    const m = summary.match(/^Ticket abierto:\s*(.+?)\s*\(sentiment:/);
    return m ? m[1].trim() : summary.slice(0, 120).trim();
  }
  const m = summary.match(/^Ticket resuelto:\s*(.+)$/);
  return m ? m[1].trim() : summary.slice(0, 120).trim();
}

function parseTicketPriority(summary: string): UiTicketRow["priority"] {
  const pm = summary.match(/priority:\s*([a-zA-Z_]+)/i);
  const raw = (pm?.[1] ?? "medium").toLowerCase();
  if (raw === "low") return "low";
  if (raw === "high" || raw === "critical") return "high";
  return "medium";
}

/** Tickets reales del timeline (aperturas y resoluciones de esta cuenta). */
export function timelineRowsToTickets(events: TimelineEventRow[]): UiTicketRow[] {
  const ticketEvents = events.filter(
    (e) => e.type === "ticket" && (e.subtype === "opened" || e.subtype === "resolved")
  );
  ticketEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return ticketEvents.map((e, i) => {
    const isResolved = e.subtype === "resolved";
    const subject = parseTicketSubject(e.summary, isResolved ? "resolved" : "opened");
    const priority = isResolved ? ("medium" as const) : parseTicketPriority(e.summary);
    return {
      id: `tl-ticket-${e.timestamp}-${i}`,
      subject: subject || "Ticket",
      priority,
      status: isResolved ? ("closed" as const) : ("open" as const),
      date: fmtShortDate(e.timestamp),
    };
  });
}

/**
 * Conversaciones del timeline para el hilo (orden cronológico).
 * Resumen backend: `{direction} {channel}: {subj} — {body}`
 */
export function timelineRowsToChat(events: TimelineEventRow[]): UiChatMsg[] {
  const convs = events.filter((e) => e.type === "conversation");
  convs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return convs.map((e, i) => {
    const re = /^(inbound|outbound|internal)\s+(\S+):\s*(.+?)\s+(?:—|-)\s+(.+)$/s;
    const m = e.summary.match(re);
    const direction = (m?.[1] ?? "outbound").toLowerCase();
    const from: UiChatMsg["from"] = direction === "inbound" ? "me" : "csm";
    const text = m
      ? [m[3].trim(), m[4].trim()].filter(Boolean).join("\n\n")
      : e.summary.trim();
    return {
      id: `tl-conv-${e.timestamp}-${i}`,
      from,
      text: text || e.summary,
      time: fmtDateTime(e.timestamp),
      source: "timeline",
    };
  });
}

export function buildWelcomeMessage(companyName: string, csmName: string): UiChatMsg {
  return {
    id: "welcome-csm",
    from: "csm",
    text: `Hola, equipo ${companyName}. Soy ${csmName}, su Customer Success Manager. Escríbenos cuando lo necesiten.`,
    time: "Ahora",
    source: "local",
  };
}
