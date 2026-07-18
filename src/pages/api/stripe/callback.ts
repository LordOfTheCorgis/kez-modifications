import type { APIRoute } from "astro";
import { getStripe } from "../../../lib/stripe";
import { getSiteUrl } from "../../../lib/settings";
import { fulfillCheckoutSession } from "../../../lib/fulfillment";

/**
 * success_url target. Independent of the webhook: whichever path runs first
 * fulfills; the other becomes a no-op via the order-status guard.
 */
export const GET: APIRoute = async ({ url }) => {
  const site = getSiteUrl();
  const redirect = (to: string) =>
    new Response(null, { status: 302, headers: { Location: `${site}${to}` } });

  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return redirect("/shop");

  const stripe = getStripe();
  if (!stripe) return redirect("/shop");

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return redirect("/shop?payment=incomplete");
    await fulfillCheckoutSession(session); // idempotent — already-paid orders just pass through
    return redirect("/account?purchase=success");
  } catch (err) {
    console.error("[stripe callback] failed", err);
    return redirect("/shop?payment=error");
  }
};
