import type { APIRoute } from "astro";
import { db } from "../../../../../lib/db";
import type { OrderRow, PackRow } from "../../../../../lib/db";
import { json, requirePerm } from "../../../../../lib/admin";
import { removeRole } from "../../../../../lib/discord";
import { logToDiscord } from "../../../../../lib/notify";
import { hasAllAccess, hasPaidOrder } from "../../../../../lib/ownership";

/**
 * Takes a pack back. The order row stays (flipped to 'revoked') so revenue
 * history and the who/why survive; every ownership check keys off 'paid', so
 * downloads stop the moment this commits.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const denied = requirePerm(locals, "orders", 2);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(params.id ?? 0)) as OrderRow | undefined;
  if (!order) return json({ error: "Order not found" }, 404);
  if (order.status !== "paid" && order.status !== "preorder")
    return json({ error: `Order is ${order.status}, nothing to revoke` }, 409);
  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(order.pack_id) as PackRow | undefined;
  const user = db.prepare("SELECT discord_id, name FROM users WHERE id = ?").get(order.user_id) as
    | { discord_id: string; name: string }
    | undefined;

  // conditional flip, same as checkout/release: two admins double-clicking can't both "win"
  const flipped = db
    .prepare("UPDATE orders SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND status = ?")
    .run(order.id, order.status).changes;
  if (!flipped) return json({ error: "Someone else just changed this order, reload" }, 409);

  let roleNote = "no discord role on this pack";
  if (pack?.discord_role_id && user) {
    // packs share roles (Kez maps a bunch to one generic Customer role). pulling it
    // because one pack got revoked would cut them off from stuff they still paid for
    const keep = db
      .prepare(
        `SELECT p.name FROM orders o JOIN packs p ON p.id = o.pack_id
         WHERE o.user_id = ? AND o.status = 'paid' AND p.discord_role_id = ? LIMIT 1`,
      )
      .get(order.user_id, pack.discord_role_id) as { name: string } | undefined;
    if (keep) roleNote = `role kept, they still own ${keep.name} which uses it`;
    else {
      const res = await removeRole(user.discord_id, pack.discord_role_id);
      roleNote = res.ok ? "role removed" : `role removal failed: ${res.note}`;
    }
  }

  const note = `revoked by ${locals.user!.name}${reason ? ` (${reason})` : ""}, ${roleNote}`;
  // append, don't overwrite: the original delivery note is part of the paper trail
  db.prepare("UPDATE orders SET delivery_note = ? WHERE id = ?").run(
    order.delivery_note ? `${order.delivery_note} | ${note}` : note,
    order.id,
  );

  const stillOwns = !!pack && (hasPaidOrder(order.user_id, pack.id) || hasAllAccess(order.user_id));
  await logToDiscord(
    `:no_entry: **${locals.user!.name}** revoked **${pack?.name ?? `pack #${order.pack_id}`}** from **${user?.name ?? "unknown"}** (order #${order.id})` +
      `\nReason: ${reason || "none given"}\nDiscord: ${roleNote}` +
      (stillOwns ? "\n:warning: They still own it through another order or all-access." : ""),
  );
  return json({ ok: true, roleNote, stillOwns });
};
