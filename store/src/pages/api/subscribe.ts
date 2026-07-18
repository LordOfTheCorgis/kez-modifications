import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import type { SubscriptionRow } from "../../lib/db";
import { getStripe } from "../../lib/stripe";
import { getSiteUrl, getTierPriceId } from "../../lib/settings";
import { rateLimit } from "../../lib/ratelimit";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  let ip = "unknown";
  try {
    ip = clientAddress;
  } catch {
    /* ignore */
  }
  if (!rateLimit(`purchase:${ip}`, 15, 60_000)) return json({ error: "Too many requests" }, 429);

  const user = locals.user;
  if (!user?.discordId) return json({ error: "Sign in with Discord first" }, 401);

  const body = (await request.json().catch(() => null)) as { tier?: string } | null;
  const tier = (body?.tier ?? "").trim().toLowerCase();
  if (!tier) return json({ error: "tier required" }, 400);

  const priceId = getTierPriceId(tier);
  if (!priceId) return json({ error: "Unknown subscription tier" }, 400);

  const stripe = getStripe();
  if (!stripe) return json({ error: "Payments are not configured yet" }, 503);

  const existing = db
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(user.id) as SubscriptionRow | undefined;
  if (existing?.status === "active") {
    return json({ error: "You already have an active subscription" }, 409);
  }

  const site = getSiteUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : {}),
    success_url: `${site}/api/stripe/callback?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/account?canceled=1`,
    metadata: { tier, userId: String(user.id), discordId: user.discordId },
    subscription_data: { metadata: { tier, userId: String(user.id), discordId: user.discordId } },
  });

  return json({ url: session.url });
};
