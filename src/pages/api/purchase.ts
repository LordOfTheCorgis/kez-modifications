import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import type { DiscountRow, PackRow } from "../../lib/db";
import { assignRole } from "../../lib/discord";
import { getStripe, getStripeConfigError, stripeErrorMessage } from "../../lib/stripe";
import { getSiteUrl } from "../../lib/settings";
import { hasPaidOrder } from "../../lib/ownership";
import { fulfillCheckoutSession } from "../../lib/fulfillment";
import { logToDiscord } from "../../lib/notify";
import { rateLimit } from "../../lib/ratelimit";

const MAX_CART_ITEMS = 20;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function validateDiscount(code: string): DiscountRow | null {
  const d = db.prepare("SELECT * FROM discounts WHERE code = ?").get(code) as DiscountRow | undefined;
  if (!d || !d.is_active) return null;
  const now = new Date().toISOString();
  if (d.starts_at && d.starts_at > now) return null;
  if (d.expires_at && d.expires_at < now) return null;
  if (d.max_uses !== null && d.uses >= d.max_uses) return null;
  return d;
}

function applyDiscount(price: number, discount: DiscountRow | null): number {
  if (!discount) return price;
  return Math.max(0, Math.round((price * (100 - discount.percent)) / 100));
}

/**
 * Accepts either { packId } (product page) or { packIds: [] } (cart). Always
 * recomputes prices server-side. Packs the buyer already owns get dropped and
 * reported back as `skipped` instead of failing the whole checkout.
 */
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

  const body = (await request.json().catch(() => null)) as {
    packId?: unknown;
    packIds?: unknown;
    discountCode?: unknown;
  } | null;

  const rawIds = Array.isArray(body?.packIds) ? body.packIds : [body?.packId];
  const packIds = [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!packIds.length) return json({ error: "packId required" }, 400);
  if (packIds.length > MAX_CART_ITEMS) return json({ error: `Max ${MAX_CART_ITEMS} items per checkout` }, 400);

  const packs = packIds
    .map((id) => db.prepare("SELECT * FROM packs WHERE id = ?").get(id) as PackRow | undefined)
    .filter((p): p is PackRow => !!p);
  if (packs.length !== packIds.length) return json({ error: "One of those packs no longer exists" }, 404);

  let discount: DiscountRow | null = null;
  const codeInput = typeof body?.discountCode === "string" ? body.discountCode.trim() : "";
  if (codeInput) {
    discount = validateDiscount(codeInput);
    if (!discount) return json({ error: "Invalid or expired discount code" }, 400);
  }

  const skipped: string[] = [];
  let wanted = packs.filter((p) => {
    if (hasPaidOrder(user.id, p.id)) {
      skipped.push(p.name);
      return false;
    }
    return true;
  });
  if (!wanted.length) return json({ error: "You already own this" }, 409);

  const stripe = getStripe();

  // Settle or kill any open checkout that overlaps this cart before charging
  // again. Paid-but-webhook-lagging sessions get fulfilled right here; open
  // ones get expired so the buyer can't end up paying twice for the same pack.
  const pendingSessions = db
    .prepare(
      `SELECT DISTINCT stripe_session_id FROM orders
       WHERE user_id = ? AND status = 'pending' AND stripe_session_id IS NOT NULL
         AND pack_id IN (${wanted.map(() => "?").join(",")})`,
    )
    .all(user.id, ...wanted.map((p) => p.id)) as { stripe_session_id: string }[];
  for (const { stripe_session_id } of pendingSessions) {
    if (!stripe) break;
    try {
      const existing = await stripe.checkout.sessions.retrieve(stripe_session_id);
      if (existing.payment_status === "paid") {
        await fulfillCheckoutSession(existing);
        continue;
      }
      if (existing.status === "open") await stripe.checkout.sessions.expire(stripe_session_id);
    } catch {
      /* stale session id — the rows get cleaned up below either way */
    }
    db.prepare("DELETE FROM orders WHERE stripe_session_id = ? AND status = 'pending'").run(stripe_session_id);
  }
  // re-check: the loop above may have just delivered something
  wanted = wanted.filter((p) => {
    if (hasPaidOrder(user.id, p.id)) {
      skipped.push(p.name);
      return false;
    }
    return true;
  });
  if (!wanted.length) return json({ error: "You already own this (payment just settled)", skipped }, 409);

  // Free lines never touch Stripe. Deliver them now and carry on with whatever
  // costs money. A $0 line in a Stripe session is legal but pointless.
  const freePacks = wanted.filter((p) => applyDiscount(p.price, discount) === 0);
  const paidPacks = wanted.filter((p) => applyDiscount(p.price, discount) > 0);
  if (freePacks.length) {
    const claimed: string[] = [];
    for (const pack of freePacks) {
      let note = "no discord role configured";
      if (pack.discord_role_id) {
        const res = await assignRole(user.discordId, pack.discord_role_id);
        note = res.ok ? "role assigned" : `role assignment failed: ${res.note}`;
      }
      db.prepare(
        `INSERT INTO orders (user_id, pack_id, status, amount, discount_code, delivery_note)
         VALUES (?, ?, 'paid', 0, ?, ?)`,
      ).run(user.id, pack.id, discount?.code ?? null, note);
      claimed.push(`**${pack.name}** (${note})`);
    }
    db.prepare("UPDATE users SET role = 'customer' WHERE id = ? AND role = 'member'").run(user.id);
    if (discount) db.prepare("UPDATE discounts SET uses = uses + 1 WHERE id = ?").run(discount.id);
    await logToDiscord(`:gift: **${user.name}** claimed free ${claimed.join(", ")}`, "sales");
  }
  if (!paidPacks.length) return json({ claimed: true, skipped });

  const configError = getStripeConfigError();
  if (configError) {
    await logToDiscord(`:warning: Checkout blocked — ${configError}`, "log");
    return json({ error: configError }, 503);
  }
  if (!stripe) return json({ error: "Payments are not configured yet" }, 503);

  const site = getSiteUrl();
  const lineItems = paidPacks.map((pack) => {
    // Stripe images must be publicly reachable; a localhost URL fails the whole session.
    const image =
      pack.image_url?.startsWith("https://") && !pack.image_url.includes("localhost") ? [pack.image_url] : undefined;
    return {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: applyDiscount(pack.price, discount),
        product_data: { name: pack.name, ...(image ? { images: image } : {}) },
      },
    };
  });
  const cancelTo = paidPacks.length === 1 ? `/product/${paidPacks[0].id}?canceled=1` : "/cart?canceled=1";

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: `${site}/api/stripe/callback?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}${cancelTo}`,
      metadata: {
        // metadata values cap at 500 chars; 20 ids fits with room to spare
        packIds: paidPacks.map((p) => p.id).join(","),
        userId: String(user.id),
        discordId: user.discordId,
        ...(discount ? { discountCode: discount.code } : {}),
      },
    });
  } catch (err: unknown) {
    // Without this, an unhandled throw returns a 500 HTML page and the buyer sees
    // a misleading "Network error" instead of what Stripe actually complained about.
    const message = stripeErrorMessage(err);
    await logToDiscord(
      `:warning: Stripe checkout failed for **${user.name}** on **${paidPacks.map((p) => p.name).join(", ")}** — ${message}`,
      "log",
    );
    return json({ error: `Stripe could not start checkout: ${message}` }, 502);
  }

  const ins = db.prepare(
    "INSERT INTO orders (user_id, pack_id, stripe_session_id, status, amount, discount_code) VALUES (?, ?, ?, 'pending', ?, ?)",
  );
  db.transaction(() => {
    for (const pack of paidPacks) {
      ins.run(user.id, pack.id, session.id, applyDiscount(pack.price, discount), discount?.code ?? null);
    }
  })();

  return json({ url: session.url, skipped });
};
