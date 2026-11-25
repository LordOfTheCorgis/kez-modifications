import type { APIRoute } from "astro";
import type Stripe from "stripe";
import { db } from "../../../lib/db";
import { getStripe } from "../../../lib/stripe";
import { getStripeWebhookSecret } from "../../../lib/settings";
import { fulfillCheckoutSession } from "../../../lib/fulfillment";
import { errText, logToDiscord } from "../../../lib/notify";

/**
 * Refunds and chargebacks don't take anything back by themselves: the buyer keeps
 * the role and the download until someone revokes the order. Auto-revoking on a
 * partial refund or a dispute we may win is a call for a human, so just shout.
 */
async function alertMoneyBack(stripe: Stripe, event: Stripe.Event) {
  const isDispute = event.type === "charge.dispute.created";
  const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
  const cents = isDispute ? (obj as Stripe.Dispute).amount : (obj as Stripe.Charge).amount_refunded;
  const pi = obj.payment_intent;
  let who = "";
  try {
    if (typeof pi === "string") {
      const [session] = (await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 })).data;
      const rows = session
        ? (db
            .prepare(
              `SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id
               WHERE o.stripe_session_id = ? ORDER BY o.id`,
            )
            .all(session.id) as { id: number; name: string }[])
        : [];
      if (rows.length) who = ` Buyer **${rows[0].name}**, order${rows.length > 1 ? "s" : ""} ${rows.map((r) => `#${r.id}`).join(", ")}.`;
    }
  } catch {
    /* the alert matters more than the lookup, send it without the buyer */
  }
  await logToDiscord(
    `:rotating_light: ${isDispute ? "Chargeback opened" : "Refund issued"} for $${(cents / 100).toFixed(2)}.${who} They keep the role and downloads until you revoke it in Admin → Orders.`,
  );
}

export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe();
  const secret = getStripeWebhookSecret();
  if (!stripe || !secret) {
    await logToDiscord(":rotating_light: Stripe webhook hit but Stripe/webhook secret isn't configured for the current mode. Payments won't auto-fulfill.");
    return new Response("Webhook not configured", { status: 503 });
  }

  // RAW body — signature verification fails on anything re-serialized.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    // almost always the wrong webhook secret for the current test/live mode.
    // the success-page callback still fulfills buyers who come back, but anyone
    // who closes the tab after paying is stuck until this is fixed
    await logToDiscord(
      `:rotating_light: Stripe webhook signature check failed, check the webhook secret in Settings → Stripe matches this mode. ${errText(err)}`,
    );
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await fulfillCheckoutSession(session);
    } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      await alertMoneyBack(stripe, event);
    }
  } catch (err) {
    await logToDiscord(`:rotating_light: Stripe webhook ${event.type} (${event.id}) crashed: ${errText(err)}. Stripe will retry.`);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
