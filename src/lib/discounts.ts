import { db } from "./db";
import type { DiscountRow } from "./db";

/**
 * exceptUserId: leave that buyer's own open checkouts out of the count, so
 * retrying their cart doesn't make a code look full because of their own abandoned tab.
 */
export function validateDiscount(code: string, exceptUserId = 0): DiscountRow | null {
  const d = db.prepare("SELECT * FROM discounts WHERE code = ?").get(code) as DiscountRow | undefined;
  if (!d || !d.is_active) return null;
  const now = new Date().toISOString();
  if (d.starts_at && d.starts_at > now) return null;
  if (d.expires_at && d.expires_at < now) return null;
  if (d.max_uses !== null) {
    // uses only goes up when Stripe confirms payment, so checkouts that are open
    // right now count too or a "first 10" code hands out 30. 30 minutes because
    // abandoned pending rows never get cleaned up and would block the code forever
    const open = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT stripe_session_id) AS n FROM orders
           WHERE discount_code = ? AND status = 'pending' AND stripe_session_id IS NOT NULL
             AND user_id != ? AND created_at > datetime('now', '-30 minutes')`,
        )
        .get(d.code, exceptUserId) as { n: number }
    ).n;
    if (d.uses + open >= d.max_uses) return null;
  }
  return d;
}

export function applyDiscount(price: number, discount: DiscountRow | null): number {
  if (!discount) return price;
  return Math.max(0, Math.round((price * (100 - discount.percent)) / 100));
}

/** Shared by the create and edit routes so they can't drift apart again. */
export function parseDiscountInput(b: Record<string, unknown> | null, fallbackPercent?: number):
  | { error: string }
  | { percent: number; maxUses: number | null; startsAt: string | null; expiresAt: string | null } {
  const percent = b?.percent ? Math.round(Number(b.percent)) : fallbackPercent;
  if (percent === undefined || !(percent >= 1 && percent <= 100)) return { error: "percent must be 1-100" };
  const maxUses = b?.max_uses ? Number(b.max_uses) : null;
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1)) return { error: "max uses must be a whole number, 1 or more" };
  const date = (v: unknown): string | null | undefined => {
    if (typeof v !== "string" || !v) return null;
    const t = new Date(v);
    return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
  };
  const startsAt = date(b?.starts_at);
  const expiresAt = date(b?.expires_at);
  if (startsAt === undefined || expiresAt === undefined) return { error: "that isn't a valid date" };
  return { percent, maxUses, startsAt, expiresAt };
}
