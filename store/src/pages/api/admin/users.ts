import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";
import { destroySessionsForUser } from "../../../lib/session";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const users = db
    .prepare(
      "SELECT id, discord_id, name, email, image, role, is_admin, is_banned, created_at FROM users ORDER BY id DESC LIMIT 500",
    )
    .all();
  return json({ users });
};

/** Staff roster management: toggle is_admin / is_banned / role label. */
export const PUT: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as {
    id?: number;
    is_admin?: boolean;
    is_banned?: boolean;
    role?: string;
  } | null;
  const id = Number(b?.id ?? 0);
  if (!id) return json({ error: "id required" }, 400);
  if (id === locals.user!.id && b?.is_admin === false) {
    return json({ error: "You cannot remove your own admin" }, 400);
  }
  const info = db
    .prepare("UPDATE users SET is_admin = ?, is_banned = ?, role = ? WHERE id = ?")
    .run(b?.is_admin ? 1 : 0, b?.is_banned ? 1 : 0, typeof b?.role === "string" ? b.role : "customer", id);
  if (!info.changes) return json({ error: "Not found" }, 404);
  if (b?.is_banned) destroySessionsForUser(id);
  return json({ ok: true });
};
