import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import { getTicket, ticketAccess, TICKET_CATEGORIES, TICKET_URGENCIES } from "../../../../lib/tickets";
import type { TicketCategory, TicketUrgency } from "../../../../lib/tickets";

const stamp = (sqlite: string) => `${sqlite.slice(0, 16)} UTC`;

/** Plain text copy of a thread. Same access as viewing it, so customers get their own and staff get any. */
export const GET: APIRoute = ({ params, locals }) => {
  const ticket = getTicket(Number(params.id ?? 0));
  if (!ticket || !ticketAccess(locals.user, ticket).view) return new Response("Not found", { status: 404 });

  const customer = db.prepare("SELECT name, discord_id FROM users WHERE id = ?").get(ticket.user_id) as
    | { name: string; discord_id: string }
    | undefined;
  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.is_staff, m.created_at, COALESCE(u.name, 'deleted user') AS author
       FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id`,
    )
    .all(ticket.id) as { id: number; body: string; is_staff: number; created_at: string; author: string }[];
  const files = db
    .prepare("SELECT message_id, original_name FROM ticket_attachments WHERE ticket_id = ? ORDER BY id")
    .all(ticket.id) as { message_id: number; original_name: string }[];

  const lines = [
    `Ticket #${ticket.id}: ${ticket.subject}`,
    `Category: ${TICKET_CATEGORIES[ticket.category as TicketCategory] ?? ticket.category}`,
    `Urgency: ${TICKET_URGENCIES[ticket.urgency as TicketUrgency] ?? ticket.urgency}`,
    `Status: ${ticket.status === "closed" ? "Closed" : "Open"}`,
    `Opened: ${stamp(ticket.created_at)} by ${customer?.name ?? "deleted user"}${customer ? ` (Discord ${customer.discord_id})` : ""}`,
    ...(ticket.order_id ? [`Order: #${ticket.order_id}`] : []),
    "",
  ];
  for (const m of messages) {
    lines.push("-".repeat(60), `[${stamp(m.created_at)}] ${m.author}${m.is_staff ? " (Staff)" : ""}`, "", m.body);
    const names = files.filter((f) => f.message_id === m.id).map((f) => f.original_name);
    if (names.length) lines.push("", `Attachments: ${names.join(", ")}`);
    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="ticket-${ticket.id}-transcript.txt"`,
      "Cache-Control": "no-store",
    },
  });
};
