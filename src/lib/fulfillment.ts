import type Stripe from "stripe";
import { db } from "./db";
import type { OrderRow, PackRow, UserRow } from "./db";
import { assignRole } from "./discord";
import { logToDiscord } from "./notify";

/**
 * Shared by GET /api/stripe/callback and POST /api/stripe/webhook.
 * Idempotency: the pending->paid flip is a single conditional UPDATE, so the
 * two paths racing each other can never double-assign roles or double-count
 * discount uses — only the path that wins the transition runs side effects.
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<{ fulfilled: boolean; reason: string }> {
  if (session.payment_status !== "paid") return { fulfilled: false, reason: "session not paid" };
  if (session.mode !== "payment") return { fulfilled: false, reason: "not a one-time payment session" };

  const packId = Number(session.metadata?.packId ?? 0);
  const userId = Number(session.metadata?.userId ?? 0);

  let order = db
    .prepare("SELECT * FROM orders WHERE stripe_session_id = ?")
    .get(session.id) as OrderRow | undefined;

  if (!order) {
    if (!packId || !userId) return { fulfilled: false, reason: "no order row and no metadata" };
    db.prepare(
      `INSERT INTO orders (user_id, pack_id, stripe_session_id, status, amount, discount_code)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).run(userId, packId, session.id, session.amount_total ?? null, session.metadata?.discountCode ?? null);
    order = db
      .prepare("SELECT * FROM orders WHERE stripe_session_id = ?")
      .get(session.id) as OrderRow;
  }

  const flip = db
    .prepare("UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(order.id);
  if (flip.changes === 0) return { fulfilled: false, reason: "already fulfilled" };

  db.prepare("UPDATE users SET role = 'customer' WHERE id = ? AND role = 'member'").run(userId);

  if (order.discount_code) {
    db.prepare("UPDATE discounts SET uses = uses + 1 WHERE code = ?").run(order.discount_code);
  }

  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(order.pack_id) as PackRow | undefined;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(order.user_id) as UserRow | undefined;
  const discordId = (session.metadata?.discordId as string | undefined) ?? user?.discord_id;

  let note = "no discord role configured";
  if (pack?.discord_role_id && discordId) {
    const res = await assignRole(discordId, pack.discord_role_id);
    note = res.ok ? "role assigned" : `role assignment failed: ${res.note}`;
  }
  db.prepare("UPDATE orders SET delivery_note = ? WHERE id = ?").run(note, order.id);

  const amount = ((session.amount_total ?? order.amount ?? 0) / 100).toFixed(2);
  await logToDiscord(
    `:moneybag: **${user?.name ?? "unknown"}** purchased **${pack?.name ?? `pack #${order.pack_id}`}** for $${amount}` +
      (order.discount_code ? ` (code \`${order.discount_code}\`)` : "") +
      ` — delivery: ${note}`,
    "sales",
  );
  return { fulfilled: true, reason: note };
}
