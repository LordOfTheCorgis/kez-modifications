import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import type { SubscriptionRow } from "../../../lib/db";
import { getStripe } from "../../../lib/stripe";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/**
 * Self-service cancel/reactivate. cancel_at_period_end keeps the role until
 * the paid period lapses; the webhook's subscription.deleted removes it then.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not signed in" }, 401);

  const body = (await request.json().catch(() => ({}))) as { reactivate?: boolean };
  const sub = db
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(user.id) as SubscriptionRow | undefined;
  if (!sub?.stripe_subscription_id) return json({ error: "No subscription found" }, 404);

  const stripe = getStripe();
  if (!stripe) return json({ error: "Payments are not configured" }, 503);

  try {
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: !body.reactivate,
    });
    db.prepare(
      "UPDATE subscriptions SET cancel_at = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null, sub.id);
    return json({ ok: true, cancelAt: updated.cancel_at });
  } catch (err) {
    console.error("[subscription cancel] failed", err);
    return json({ error: "Could not update subscription" }, 502);
  }
};
