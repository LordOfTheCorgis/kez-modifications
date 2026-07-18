import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  return json({ categories: db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all() });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = (b?.name ?? "").trim();
  if (!name) return json({ error: "name required" }, 400);
  const info = db
    .prepare(
      "INSERT INTO categories (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories))",
    )
    .run(name);
  return json({ id: Number(info.lastInsertRowid) });
};
