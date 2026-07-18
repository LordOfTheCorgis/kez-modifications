import type Stripe from "stripe";
import { db } from "./db";
import type { OrderRow, PackRow, SubscriptionRow, UserRow } from "./db";
import { assignRole, removeRole } from "./discord";
import { getTierRoleId } from "./settings";
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

/**
 * Idempotent fulfillment for mode:'subscription' checkout sessions — creates
 * the local subscription row (so later webhook events can resolve the Stripe
 * customer) and grants the tier role.
 */
export async function fulfillSubscriptionCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;
  const userId = Number(session.metadata?.userId ?? 0);
  const tier = (session.metadata?.tier as string | undefined) ?? "";
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!userId || !customerId) return;

  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(userId) as SubscriptionRow | undefined;
  const alreadyFulfilled =
    existing?.status === "active" && existing.stripe_subscription_id === (subId ?? null);

  db.prepare(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier, status)
     VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id, tier = excluded.tier,
       status = 'active', cancel_at = NULL, updated_at = datetime('now')`,
  ).run(userId, customerId, subId ?? null, tier || null);

  if (alreadyFulfilled) return;

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  const roleId = tier ? getTierRoleId(tier) : "";
  let note = "no tier role configured";
  if (user && roleId) {
    const res = await assignRole(user.discord_id, roleId);
    note = res.ok ? "role assigned" : `role assignment failed: ${res.note}`;
  }
  await logToDiscord(
    `:sparkles: **${user?.name ?? `user #${userId}`}** started a **${tier || "?"}** subscription — delivery: ${note}`,
    "sales",
  );
}

function localStatus(sub: Stripe.Subscription, deleted: boolean): SubscriptionRow["status"] | null {
  if (deleted || sub.status === "canceled" || sub.status === "incomplete_expired") return "canceled";
  if (sub.status === "active" || sub.status === "trialing") return "active";
  if (sub.status === "past_due") return "past_due";
  if (sub.status === "unpaid" || sub.status === "paused") return "unpaid";
  return null; // incomplete etc. — leave the local row alone
}

/** Handles customer.subscription.updated / .deleted webhook events. */
export async function handleSubscriptionEvent(sub: Stripe.Subscription, eventType: string): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const row = db
    .prepare("SELECT * FROM subscriptions WHERE stripe_customer_id = ?")
    .get(customerId) as SubscriptionRow | undefined;
  if (!row) {
    console.error(`[fulfillment] subscription event for unknown customer ${customerId}`);
    return;
  }

  const deleted = eventType === "customer.subscription.deleted";
  const status = localStatus(sub, deleted);
  if (!status) return;

  const tier = (sub.metadata?.tier as string | undefined) ?? row.tier ?? "";
  const roleId = tier ? getTierRoleId(tier) : "";
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as UserRow | undefined;

  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  db.prepare(
    `UPDATE subscriptions SET status = ?, tier = ?, stripe_subscription_id = ?, cancel_at = ?, expires_at = ?,
     updated_at = datetime('now') WHERE id = ?`,
  ).run(
    status,
    tier || null,
    sub.id,
    sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    row.id,
  );

  const who = user?.name ?? `user #${row.user_id}`;
  if (status === "active") {
    if (user && roleId) await assignRole(user.discord_id, roleId);
    if (row.status !== "active") {
      await logToDiscord(`:star: **${who}** subscription (**${tier}**) is now active`, "sales");
    } else if (sub.cancel_at && !row.cancel_at) {
      await logToDiscord(`:wave: **${who}** scheduled cancellation of **${tier}** at period end`, "sales");
    } else if (!sub.cancel_at && row.cancel_at) {
      await logToDiscord(`:tada: **${who}** reactivated their **${tier}** subscription`, "sales");
    }
  } else if (status === "canceled") {
    // Only strip the role once the subscription actually ends.
    if (user && roleId) await removeRole(user.discord_id, roleId);
    if (row.status !== "canceled") {
      await logToDiscord(`:x: **${who}** subscription (**${tier}**) ended — role removed`, "sales");
    }
  } else {
    // past_due / unpaid: keep the role, let Stripe dunning resolve it first.
    if (row.status === "active") {
      await logToDiscord(`:warning: **${who}** subscription (**${tier}**) has a payment issue (${sub.status})`, "sales");
    }
  }
}
