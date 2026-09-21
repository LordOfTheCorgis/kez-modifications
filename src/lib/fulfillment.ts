import type Stripe from "stripe";
import { db } from "./db";
import type { OrderRow, PackRow, UserRow } from "./db";
import { assignRole } from "./discord";
import { logToDiscord } from "./notify";

/**
 * Shared by GET /api/stripe/callback and POST /api/stripe/webhook.
 * One checkout session can now cover several packs (cart), so there are N
 * pending order rows sharing the session id. Idempotency: each row's
 * pending->paid flip is its own conditional UPDATE, so the two paths racing
 * each other never double-assign a role. Discount uses bump once per session,
 * gated on whether this call flipped anything at all.
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<{ fulfilled: boolean; reason: string }> {
  if (session.payment_status !== "paid") return { fulfilled: false, reason: "session not paid" };
  if (session.mode !== "payment") return { fulfilled: false, reason: "not a one-time payment session" };

  const userId = Number(session.metadata?.userId ?? 0);

  let orders = db
    .prepare("SELECT * FROM orders WHERE stripe_session_id = ? ORDER BY id")
    .all(session.id) as OrderRow[];

  if (orders.length === 0) {
    // no rows means the db lost them (or the session was created outside this
    // app). rebuild from metadata so the buyer still gets what they paid for.
    const packIds = (session.metadata?.packIds ?? session.metadata?.packId ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    if (!packIds.length || !userId) return { fulfilled: false, reason: "no order rows and no metadata" };
    const ins = db.prepare(
      `INSERT INTO orders (user_id, pack_id, stripe_session_id, status, amount, discount_code)
       VALUES (?, ?, ?, 'pending', NULL, ?)`,
    );
    for (const packId of packIds) ins.run(userId, packId, session.id, session.metadata?.discountCode ?? null);
    orders = db
      .prepare("SELECT * FROM orders WHERE stripe_session_id = ? ORDER BY id")
      .all(session.id) as OrderRow[];
  }

  const flipStmt = db.prepare(
    "UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
  );
  const flipped = orders.filter((o) => flipStmt.run(o.id).changes > 0);
  if (flipped.length === 0) return { fulfilled: false, reason: "already fulfilled" };

  const buyerId = flipped[0].user_id;
  db.prepare("UPDATE users SET role = 'customer' WHERE id = ? AND role = 'member'").run(buyerId);

  const discountCode = flipped[0].discount_code;
  if (discountCode) {
    db.prepare("UPDATE discounts SET uses = uses + 1 WHERE code = ?").run(discountCode);
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(buyerId) as UserRow | undefined;
  const discordId = (session.metadata?.discordId as string | undefined) ?? user?.discord_id;

  const lines: string[] = [];
  for (const order of flipped) {
    const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(order.pack_id) as PackRow | undefined;
    let note = "no discord role configured";
    if (pack?.discord_role_id && discordId) {
      const res = await assignRole(discordId, pack.discord_role_id);
      note = res.ok ? "role assigned" : `role assignment failed: ${res.note}`;
    }
    db.prepare("UPDATE orders SET delivery_note = ? WHERE id = ?").run(note, order.id);
    lines.push(`**${pack?.name ?? `pack #${order.pack_id}`}** (${note})`);
  }

  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  await logToDiscord(
    `:moneybag: **${user?.name ?? "unknown"}** purchased ${lines.join(", ")} for $${amount}` +
      (discountCode ? ` (code \`${discountCode}\`)` : ""),
    "sales",
  );
  return { fulfilled: true, reason: `${flipped.length} pack(s) delivered` };
}
