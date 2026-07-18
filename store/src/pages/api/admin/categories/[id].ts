import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import { json, requireAdmin } from "../../../../lib/admin";

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = (b?.name ?? "").trim();
  if (!name) return json({ error: "name required" }, 400);
  const info = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, Number(params.id ?? 0));
  return info.changes ? json({ ok: true }) : json({ error: "Not found" }, 404);
};

export const DELETE: APIRoute = ({ params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  // packs.category_id has ON DELETE SET NULL — packs survive category removal.
  const info = db.prepare("DELETE FROM categories WHERE id = ?").run(Number(params.id ?? 0));
  return info.changes ? json({ ok: true }) : json({ error: "Not found" }, 404);
};
