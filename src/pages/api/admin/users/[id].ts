import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import type { PackRow, UserRow } from "../../../../lib/db";
import { json, requirePerm } from "../../../../lib/admin";
import { isOwnerUser, parsePerms } from "../../../../lib/perms";
import { ownsPack } from "../../../../lib/ownership";

/** Everything the user detail panel shows. */
export const GET: APIRoute = ({ params, locals }) => {
  const denied = requirePerm(locals, "users", 1);
  if (denied) return denied;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(params.id ?? 0)) as UserRow | undefined;
  if (!user) return json({ error: "Not found" }, 404);
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.amount, o.discount_code, o.delivery_note, o.created_at, p.name AS pack_name
       FROM orders o LEFT JOIN packs p ON p.id = o.pack_id
       WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`,
    )
    .all(user.id);
  const packs = db.prepare("SELECT * FROM packs ORDER BY sort_order, id").all() as PackRow[];
  const owned = packs.filter((p) => ownsPack(user.id, p)).map((p) => ({ id: p.id, name: p.name }));
  const downloads = (
    db.prepare("SELECT COUNT(*) AS n FROM download_logs WHERE user_id = ?").get(user.id) as { n: number }
  ).n;
  return json({
    user: {
      id: user.id,
      discord_id: user.discord_id,
      name: user.name,
      image: user.image,
      role: user.role,
      is_admin: user.is_admin,
      is_banned: user.is_banned,
      is_owner: isOwnerUser(user),
      staff_role_id: user.staff_role_id,
      perm_overrides: parsePerms(user.perm_overrides),
      created_at: user.created_at,
    },
    orders,
    owned,
    downloads,
  });
};
