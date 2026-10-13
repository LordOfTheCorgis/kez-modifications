import type { APIRoute } from "astro";
import type Stripe from "stripe";
import { getStripe } from "../../../lib/stripe";
import { getStripeWebhookSecret } from "../../../lib/settings";
import { fulfillCheckoutSession } from "../../../lib/fulfillment";
import { errText, logToDiscord } from "../../../lib/notify";

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
    }
  } catch (err) {
    await logToDiscord(`:rotating_light: Stripe webhook ${event.type} (${event.id}) crashed: ${errText(err)}. Stripe will retry.`);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
