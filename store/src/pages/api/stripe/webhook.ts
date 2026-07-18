import type { APIRoute } from "astro";
import type Stripe from "stripe";
import { getStripe } from "../../../lib/stripe";
import { getStripeWebhookSecret } from "../../../lib/settings";
import {
  fulfillCheckoutSession,
  fulfillSubscriptionCheckout,
  handleSubscriptionEvent,
} from "../../../lib/fulfillment";

export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe();
  const secret = getStripeWebhookSecret();
  if (!stripe || !secret) return new Response("Webhook not configured", { status: 503 });

  // RAW body — signature verification fails on anything re-serialized.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.error("[webhook] signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") await fulfillSubscriptionCheckout(session);
        else await fulfillCheckoutSession(session);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription, event.type);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[webhook] handler for ${event.type} failed`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
