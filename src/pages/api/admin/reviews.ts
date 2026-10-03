import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requirePerm } from "../../../lib/admin";

export const GET: APIRoute = ({ locals }) => {
  const denied = requirePerm(locals, "reviews", 1);
  if (denied) return denied;
  const reviews = db
    .prepare(
      `SELECT r.id, r.rating, r.message, r.is_approved, r.created_at, u.name, u.image
       FROM reviews r JOIN users u ON u.id = r.user_id
       ORDER BY r.is_approved ASC, r.created_at DESC`,
    )
    .all();
  return json({ reviews });
};
