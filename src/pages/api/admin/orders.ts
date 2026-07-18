import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const orders = db
    .prepare(
      `SELECT o.*, u.name AS user_name, u.discord_id, p.name AS pack_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN packs p ON p.id = o.pack_id
       ORDER BY o.id DESC LIMIT 500`,
    )
    .all();
  return json({ orders });
};
