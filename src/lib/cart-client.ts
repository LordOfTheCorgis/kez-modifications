// Browser-side cart. Cookie instead of localStorage so SSR can render the cart
// page and the nav count without a round trip. Not httpOnly on purpose.
const COOKIE = "kez_cart";
const MAX = 20;
const TTL = 60 * 60 * 24 * 30;

function read(): number[] {
  const match = document.cookie.match(/(?:^|;\s*)kez_cart=([^;]*)/);
  const ids = (match ? decodeURIComponent(match[1]) : "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, MAX);
}

function write(ids: number[]) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${ids.join(",")}; Path=/; Max-Age=${ids.length ? TTL : 0}; SameSite=Lax${secure}`;
  document.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((el) => {
    el.textContent = String(ids.length);
    el.hidden = ids.length === 0;
  });
}

export const cart = {
  ids: read,
  has: (id: number) => read().includes(id),
  add(id: number): boolean {
    const ids = read();
    if (ids.includes(id)) return true;
    if (ids.length >= MAX) return false;
    write([...ids, id]);
    return true;
  },
  remove(id: number) {
    write(read().filter((x) => x !== id));
  },
  clear() {
    write([]);
  },
};
