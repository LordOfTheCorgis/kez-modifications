import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import type { DiscountRow, OrderRow, PackRow } from "../../lib/db";
import { assignRole } from "../../lib/discord";
import { getStripe } from "../../lib/stripe";
import { getSiteUrl } from "../../lib/settings";
import { hasPaidOrder } from "../../lib/ownership";
import { fulfillCheckoutSession } from "../../lib/fulfillment";
import { logToDiscord } from "../../lib/notify";
import { rateLimit } from "../../lib/ratelimit";

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
    packId?: number;
    discountCode?: string;
  } | null;
  const packId = Number(body?.packId ?? 0);
  if (!packId) return json({ error: "packId required" }, 400);

  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(packId) as PackRow | undefined;
  if (!pack) return json({ error: "Pack not found" }, 404);

  // Server-side price. Never trust a client-supplied amount.
  let price = pack.price;
  let discount: DiscountRow | null = null;
  const codeInput = (body?.discountCode ?? "").trim();
  if (codeInput) {
    discount = validateDiscount(codeInput);
    if (!discount) return json({ error: "Invalid or expired discount code" }, 400);
    price = Math.max(0, Math.round((pack.price * (100 - discount.percent)) / 100));
  }

  // Duplicate-ownership guard BEFORE any Stripe session is created.
  if (pack.discord_role_id && user.discordRoles.includes(pack.discord_role_id)) {
    return json({ error: "You already own this" }, 409);
  }
  if (hasPaidOrder(user.id, pack.id)) {
    return json({ error: "You already own this" }, 409);
  }

  // Free products: deliver directly, no Stripe involved.
  if (price === 0) {
    let note = "no discord role configured";
    if (pack.discord_role_id) {
      const res = await assignRole(user.discordId, pack.discord_role_id);
      note = res.ok ? "role assigned" : `role assignment failed: ${res.note}`;
    }
    db.prepare(
      `INSERT INTO orders (user_id, pack_id, status, amount, discount_code, delivery_note)
       VALUES (?, ?, 'paid', 0, ?, ?)`,
    ).run(user.id, pack.id, discount?.code ?? null, note);
    db.prepare("UPDATE users SET role = 'customer' WHERE id = ? AND role = 'member'").run(user.id);
    if (discount) db.prepare("UPDATE discounts SET uses = uses + 1 WHERE id = ?").run(discount.id);
    await logToDiscord(
      `:gift: **${user.name}** claimed free pack **${pack.name}** — delivery: ${note}`,
      "sales",
    );
    return json({ claimed: true });
  }

  const stripe = getStripe();
  if (!stripe) return json({ error: "Payments are not configured yet" }, 503);

  // Reuse an open checkout / settle webhook-lag before charging again.
  const pending = db
    .prepare(
      "SELECT * FROM orders WHERE user_id = ? AND pack_id = ? AND status = 'pending' AND stripe_session_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(user.id, pack.id) as OrderRow | undefined;
  if (pending?.stripe_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(pending.stripe_session_id);
      if (existing.payment_status === "paid") {
        await fulfillCheckoutSession(existing);
        return json({ error: "You already own this (payment just settled)" }, 409);
      }
      if (existing.status === "open" && existing.url) {
        return json({ url: existing.url });
      }
    } catch {
      /* stale session id — fall through and create a new one */
    }
  }

  const site = getSiteUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: price,
          product_data: {
            name: pack.name,
            ...(pack.image_url?.startsWith("http") ? { images: [pack.image_url] } : {}),
          },
        },
      },
    ],
    success_url: `${site}/api/stripe/callback?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/product/${pack.id}?canceled=1`,
    metadata: {
      packId: String(pack.id),
      userId: String(user.id),
      discordId: user.discordId,
      ...(discount ? { discountCode: discount.code } : {}),
    },
  });

  if (pending) {
    db.prepare(
      "UPDATE orders SET stripe_session_id = ?, amount = ?, discount_code = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(session.id, price, discount?.code ?? null, pending.id);
  } else {
    db.prepare(
      "INSERT INTO orders (user_id, pack_id, stripe_session_id, status, amount, discount_code) VALUES (?, ?, ?, 'pending', ?, ?)",
    ).run(user.id, pack.id, session.id, price, discount?.code ?? null);
  }

  return json({ url: session.url });
};
