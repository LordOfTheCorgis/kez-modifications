import type { APIRoute } from "astro";
import { db } from "../../../../../lib/db";
import type { OrderRow, PackRow } from "../../../../../lib/db";
import { json, requirePerm } from "../../../../../lib/admin";
import { assignRole } from "../../../../../lib/discord";
import { logToDiscord } from "../../../../../lib/notify";

/**
 * Resend the Discord role on a paid order. Grant pack refuses people who
 * already own it, so this is the only way to fix "paid, role failed" from the
 * site once whatever broke it (bot role too low, user not in server) is fixed.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const denied = requirePerm(locals, "orders", 2);
  if (denied) return denied;
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(params.id ?? 0)) as OrderRow | undefined;
  if (!order) return json({ error: "Order not found" }, 404);
  if (order.status !== "paid") return json({ error: `Order is ${order.status}, nothing to deliver yet` }, 409);
  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(order.pack_id) as PackRow | undefined;
  if (!pack?.discord_role_id) return json({ error: "That pack has no Discord role set" }, 400);
  const user = db.prepare("SELECT discord_id, name FROM users WHERE id = ?").get(order.user_id) as
    | { discord_id: string; name: string }
    | undefined;
  if (!user) return json({ error: "Buyer account is gone" }, 404);

  const res = await assignRole(user.discord_id, pack.discord_role_id);
  const note = res.ok ? `role assigned (retry by ${locals.user!.name})` : `role assignment failed: ${res.note}`;
  db.prepare("UPDATE orders SET delivery_note = ?, updated_at = datetime('now') WHERE id = ?").run(note, order.id);
  if (res.ok) await logToDiscord(`:white_check_mark: Role resent for order #${order.id}: **${pack.name}** → **${user.name}**`, "sales");
  return res.ok ? json({ ok: true }) : json({ error: res.note }, 502);
};
