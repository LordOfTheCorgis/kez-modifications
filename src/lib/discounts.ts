import { db } from "./db";
import type { DiscountRow } from "./db";

export function validateDiscount(code: string): DiscountRow | null {
  const d = db.prepare("SELECT * FROM discounts WHERE code = ?").get(code) as DiscountRow | undefined;
  if (!d || !d.is_active) return null;
  const now = new Date().toISOString();
  if (d.starts_at && d.starts_at > now) return null;
  if (d.expires_at && d.expires_at < now) return null;
  if (d.max_uses !== null && d.uses >= d.max_uses) return null;
  return d;
}

export function applyDiscount(price: number, discount: DiscountRow | null): number {
  if (!discount) return price;
  return Math.max(0, Math.round((price * (100 - discount.percent)) / 100));
}
