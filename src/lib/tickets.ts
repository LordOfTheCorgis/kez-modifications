import { db } from "./db";
import type { TicketRow } from "./db";
import { can } from "./perms";
import { logToDiscord } from "./notify";
import { getSiteUrl } from "./settings";

export const TICKET_CATEGORIES = {
  payment: "Purchase or payment",
  download: "Download problem",
  install: "Installation help",
  roles: "Discord role missing",
  commission: "Commission",
  other: "Something else",
} as const;
export type TicketCategory = keyof typeof TICKET_CATEGORIES;

export const TICKET_URGENCIES = {
  low: "Low, whenever",
  normal: "Normal",
  high: "High, blocking me",
  urgent: "Urgent, server down",
} as const;
export type TicketUrgency = keyof typeof TICKET_URGENCIES;

// same red/amber/blue/grey the log embeds use, so staff read urgency at a glance in discord
const URGENCY_COLOR: Record<TicketUrgency, number> = { low: 0x8b8d98, normal: 0x3e8ef7, high: 0xf5a524, urgent: 0xe5484d };

export const MAX_TICKET_BODY = 4000;

export function getTicket(id: number): TicketRow | undefined {
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow | undefined;
}

/** Owner of the ticket, or staff with the given support level. */
export function ticketAccess(user: App.Locals["user"], ticket: TicketRow): { view: boolean; staff: boolean; reply: boolean } {
  if (!user) return { view: false, staff: false, reply: false };
  const mine = ticket.user_id === user.id;
  const staffView = can(user, "support", 1);
  const staffEdit = can(user, "support", 2);
  return { view: mine || staffView, staff: !mine && staffView, reply: mine || staffEdit };
}

export async function notifyTicket(ticket: TicketRow, who: string, kind: "new" | "reply", body: string) {
  const fields = [
    { name: "Category", value: TICKET_CATEGORIES[ticket.category as TicketCategory] ?? ticket.category, inline: true },
    { name: "Urgency", value: TICKET_URGENCIES[ticket.urgency as TicketUrgency] ?? ticket.urgency, inline: true },
    { name: "From", value: who, inline: true },
  ];
  if (ticket.order_id) fields.push({ name: "Order", value: `#${ticket.order_id}`, inline: true });
  fields.push({ name: kind === "new" ? "Message" : "Reply", value: body, inline: false });
  await logToDiscord(
    `:ticket: ${kind === "new" ? "New ticket" : "Customer replied on"} #${ticket.id}: **${ticket.subject}**`,
    "support",
    {
      fields,
      url: `${getSiteUrl()}/support/${ticket.id}`,
      color: URGENCY_COLOR[ticket.urgency as TicketUrgency],
    },
  );
}
