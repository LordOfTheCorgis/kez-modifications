import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import type { PackRow } from "../../lib/db";
import { applyDiscount, validateDiscount } from "../../lib/discounts";
import { rateLimit } from "../../lib/ratelimit";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/**
 * Cart "Apply" button. Preview only: purchase.ts re-validates the code and
 * recomputes every price, so nothing here can be trusted into a charge.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  let ip = "unknown";
  try {
    ip = clientAddress;
  } catch {
    /* ignore */
  }
  // otherwise this is a free oracle for guessing codes
  if (!rateLimit(`discount:${ip}`, 10, 60_000)) return json({ error: "Too many tries, wait a minute" }, 429);

  const body = (await request.json().catch(() => null)) as { code?: unknown; packIds?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const ids = Array.isArray(body?.packIds) ? body.packIds.map(Number).filter(Number.isInteger).slice(0, 20) : [];
  if (!code) return json({ error: "Enter a code" }, 400);

  const discount = validateDiscount(code);
  if (!discount) return json({ error: "Invalid or expired discount code" }, 404);

  const prices = ids
    .map((id) => (db.prepare("SELECT price FROM packs WHERE id = ?").get(id) as Pick<PackRow, "price"> | undefined)?.price)
    .filter((p): p is number => p !== undefined);
  const subtotal = prices.reduce((a, p) => a + p, 0);
  // per-line rounding, same as the stripe line items, so the preview matches the charge to the cent
  const total = prices.reduce((a, p) => a + applyDiscount(p, discount), 0);
  return json({ code: discount.code, percent: discount.percent, savings: subtotal - total, total });
};
