import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import type { UserRow } from "../../../lib/db";
import { json, requirePerm } from "../../../lib/admin";
import { destroySessionsForUser } from "../../../lib/session";
import { isOwnerUser, parsePerms } from "../../../lib/perms";

const FILTERS: Record<string, string> = {
  all: "1 = 1",
  staff: "(u.is_admin = 1 OR u.staff_role_id IS NOT NULL OR u.perm_overrides != '{}' OR u.role = 'owner')",
  customers: "EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ('paid', 'preorder'))",
  banned: "u.is_banned = 1",
};

/** ?q= matches name or discord id, ?filter= one of FILTERS. */
export const GET: APIRoute = ({ locals, url }) => {
  const denied = requirePerm(locals, "users", 1);
  if (denied) return denied;
  const q = (url.searchParams.get("q") ?? "").trim();
  const where = FILTERS[url.searchParams.get("filter") ?? "all"] ?? FILTERS.all;
  const users = db
    .prepare(
      `SELECT u.id, u.discord_id, u.name, u.image, u.role, u.is_admin, u.is_banned, u.staff_role_id,
         u.perm_overrides, u.created_at, r.name AS staff_role_name,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_orders
       FROM users u LEFT JOIN staff_roles r ON r.id = u.staff_role_id
       WHERE ${where} AND (? = '' OR u.name LIKE ? OR u.discord_id = ?)
       ORDER BY u.id DESC LIMIT 200`,
    )
    .all(q, `%${q}%`, q) as (UserRow & { staff_role_name: string | null })[];
  return json({
    users: users.map((u) => ({ ...u, is_owner: isOwnerUser(u) })),
    canManageStaff: locals.user!.isOwner,
  });
};

/**
 * Ban/unban needs Users edit. Anything touching access (full admin, staff
 * role, overrides, the owner label) is owner only.
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const denied = requirePerm(locals, "users", 2);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(b?.id ?? 0);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!b || !target) return json({ error: "Not found" }, 404);

  const touchesAccess = ["is_admin", "staff_role_id", "perm_overrides", "role"].some((k) => k in b);
  if (touchesAccess && !locals.user!.isOwner) return json({ error: "Only the owner can change staff access" }, 403);
  // staff banning the owner, or each other, is how you get a very bad afternoon
  if ("is_banned" in b && (isOwnerUser(target) || ((target.is_admin || target.staff_role_id) && !locals.user!.isOwner))) {
    return json({ error: "Only the owner can ban staff, and nobody can ban the owner" }, 403);
  }
  if (id === locals.user!.id && (b.is_admin === false || b.is_banned === true)) {
    return json({ error: "Not on yourself" }, 400);
  }

  const ALLOWED_ROLES = ["member", "customer", "developer", "staff", "owner"];
  if ("role" in b && (typeof b.role !== "string" || !ALLOWED_ROLES.includes(b.role))) {
    return json({ error: `role must be one of: ${ALLOWED_ROLES.join(", ")}` }, 400);
  }
  let staffRoleId: number | null = target.staff_role_id;
  if ("staff_role_id" in b) {
    staffRoleId = b.staff_role_id ? Number(b.staff_role_id) : null;
    if (staffRoleId && !db.prepare("SELECT 1 FROM staff_roles WHERE id = ?").get(staffRoleId)) {
      return json({ error: "That staff role doesn't exist" }, 400);
    }
  }

  db.prepare(
    "UPDATE users SET is_admin = ?, is_banned = ?, role = ?, staff_role_id = ?, perm_overrides = ? WHERE id = ?",
  ).run(
    "is_admin" in b ? (b.is_admin ? 1 : 0) : target.is_admin,
    "is_banned" in b ? (b.is_banned ? 1 : 0) : target.is_banned,
    "role" in b ? (b.role as string) : target.role,
    staffRoleId,
    "perm_overrides" in b ? JSON.stringify(parsePerms(b.perm_overrides)) : target.perm_overrides,
    id,
  );
  if (b.is_banned === true) destroySessionsForUser(id);
  return json({ ok: true });
};
