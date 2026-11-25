import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import { json, requirePerm } from "../../../../lib/admin";
import { logToDiscord } from "../../../../lib/notify";
import { removeStoredFiles } from "../../../../lib/ticket-files";
import { getTicket } from "../../../../lib/tickets";

/**
 * Permanent delete: ticket, every message, every attachment file. Staff with
 * Support edit only. Customers have no route to this on purpose, they can
 * close a ticket and that's it, otherwise a dispute thread could vanish on request.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const denied = requirePerm(locals, "support", 2);
  if (denied) return denied;
  const ticket = getTicket(Number(params.id ?? 0));
  if (!ticket) return json({ error: "Not found" }, 404);

  const customer = db.prepare("SELECT name FROM users WHERE id = ?").get(ticket.user_id) as { name: string } | undefined;
  const messages = (db.prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ?").get(ticket.id) as { n: number }).n;
  const stored = (
    db.prepare("SELECT stored_name FROM ticket_attachments WHERE ticket_id = ?").all(ticket.id) as { stored_name: string }[]
  ).map((r) => r.stored_name);

  // rows first: if this throws the files are still there and nothing is half deleted.
  // messages and attachment rows go with it through ON DELETE CASCADE
  db.prepare("DELETE FROM tickets WHERE id = ?").run(ticket.id);
  removeStoredFiles(stored);

  await logToDiscord(
    `:ticket: **${locals.user!.name}** permanently deleted ticket #${ticket.id} **${ticket.subject}** from **${customer?.name ?? "unknown"}**` +
      `\n${messages} message${messages === 1 ? "" : "s"} and ${stored.length} attachment${stored.length === 1 ? "" : "s"} removed.`,
    "support",
    { color: 0x8b8d98 },
  );
  return json({ ok: true });
};
