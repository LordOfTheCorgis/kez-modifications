import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import type { TicketRow } from "../../lib/db";
import { json } from "../../lib/admin";
import { rateLimit } from "../../lib/ratelimit";
import { MAX_TICKET_BODY, notifyTicket, TICKET_CATEGORIES, TICKET_URGENCIES } from "../../lib/tickets";

const MAX_OPEN_PER_USER = 5;

/** Customer opens a ticket. First message goes in with it. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in to open a ticket" }, 401);

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  const category = typeof b?.category === "string" && b.category in TICKET_CATEGORIES ? b.category : null;
  const urgency = typeof b?.urgency === "string" && b.urgency in TICKET_URGENCIES ? b.urgency : null;
  if (subject.length < 3 || subject.length > 120) return json({ error: "Subject needs 3 to 120 characters" }, 400);
  if (!body || body.length > MAX_TICKET_BODY) return json({ error: `Message needs 1 to ${MAX_TICKET_BODY} characters` }, 400);
  if (!category || !urgency) return json({ error: "Pick a category and urgency" }, 400);

  // only their own orders, otherwise the order picker is a way to poke at other people's ids
  let orderId: number | null = null;
  if (b?.order_id) {
    const id = Number(b.order_id);
    if (!db.prepare("SELECT 1 FROM orders WHERE id = ? AND user_id = ?").get(id, user.id))
      return json({ error: "That order isn't on your account" }, 400);
    orderId = id;
  }

  const open = (db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status = 'open'").get(user.id) as { n: number }).n;
  if (open >= MAX_OPEN_PER_USER)
    return json({ error: `You have ${open} open tickets. Reply on one of those, or close one first.` }, 409);

  // after validation, so fat-fingering the form a few times doesn't lock anyone out
  if (!rateLimit(`ticket:${user.id}`, 5, 60 * 60_000)) return json({ error: "That's a lot of tickets, try again in a bit" }, 429);

  const id = db.transaction(() => {
    const t = db
      .prepare("INSERT INTO tickets (user_id, subject, category, urgency, order_id) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, subject, category, urgency, orderId);
    db.prepare("INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body) VALUES (?, ?, 0, ?)").run(
      t.lastInsertRowid,
      user.id,
      body,
    );
    return Number(t.lastInsertRowid);
  })();

  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow;
  await notifyTicket(ticket, `${user.name} (${user.discordId})`, "new", body);
  return json({ id });
};
