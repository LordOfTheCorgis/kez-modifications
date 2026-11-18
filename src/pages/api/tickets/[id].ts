import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json } from "../../../lib/admin";
import { rateLimit } from "../../../lib/ratelimit";
import { getTicket, MAX_TICKET_BODY, notifyTicket, ticketAccess } from "../../../lib/tickets";

/** Poll for new messages. ?after=<last message id the page has>. */
export const GET: APIRoute = ({ params, url, locals }) => {
  const ticket = getTicket(Number(params.id ?? 0));
  // 404 not 403 for other people's tickets, no point confirming the id exists
  if (!ticket || !ticketAccess(locals.user, ticket).view) return json({ error: "Not found" }, 404);
  const after = Number(url.searchParams.get("after") ?? 0) || 0;
  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.is_staff, m.created_at, COALESCE(u.name, 'deleted user') AS author, u.image
       FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = ? AND m.id > ? ORDER BY m.id`,
    )
    .all(ticket.id, after);
  return json({ status: ticket.status, awaiting: ticket.awaiting, messages });
};

/** Reply. Replying to a closed ticket reopens it, same as every helpdesk. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const ticket = getTicket(Number(params.id ?? 0));
  if (!ticket || !user) return json({ error: "Not found" }, 404);
  const access = ticketAccess(user, ticket);
  if (!access.view) return json({ error: "Not found" }, 404);
  if (!access.reply) return json({ error: "You have view-only access to support" }, 403);
  if (!rateLimit(`ticket-reply:${user.id}`, 20, 60_000)) return json({ error: "Slow down a little" }, 429);

  const b = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!body || body.length > MAX_TICKET_BODY) return json({ error: `Message needs 1 to ${MAX_TICKET_BODY} characters` }, 400);

  db.transaction(() => {
    db.prepare("INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body) VALUES (?, ?, ?, ?)").run(
      ticket.id,
      user.id,
      access.staff ? 1 : 0,
      body,
    );
    db.prepare(
      "UPDATE tickets SET status = 'open', awaiting = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(access.staff ? "customer" : "staff", ticket.id);
  })();

  // staff replies don't ping anywhere: the customer sees it live or next time they check /account
  if (!access.staff) await notifyTicket(ticket, `${user.name} (${user.discordId})`, "reply", body);
  return json({ ok: true });
};

/** { status: "open" | "closed" }. Customers can close their own, staff can do both. */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const ticket = getTicket(Number(params.id ?? 0));
  if (!ticket || !user) return json({ error: "Not found" }, 404);
  const access = ticketAccess(user, ticket);
  if (!access.view) return json({ error: "Not found" }, 404);
  const b = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = b?.status === "open" || b?.status === "closed" ? b.status : null;
  if (!status) return json({ error: "status must be open or closed" }, 400);
  const isOwner = ticket.user_id === user.id;
  // customers reopen by replying, the button is staff-only
  if (!access.reply || (isOwner && status === "open"))
    return json({ error: "Not allowed" }, 403);
  db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, ticket.id);
  return json({ ok: true });
};
