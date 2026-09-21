import type { AstroCookies } from "astro";

export const CART_COOKIE = "kez_cart";
export const MAX_CART_ITEMS = 20;

/** Server-side read of the cart cookie. Client writes it, see cart-client.ts. */
export function readCart(cookies: AstroCookies): number[] {
  const raw = cookies.get(CART_COOKIE)?.value ?? "";
  const ids = raw
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, MAX_CART_ITEMS);
}
