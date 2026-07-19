import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import { json, requireAdmin } from "../../../../lib/admin";

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { is_approved?: unknown } | null;
  const info = db
    .prepare("UPDATE reviews SET is_approved = ? WHERE id = ?")
    .run(b?.is_approved ? 1 : 0, Number(params.id ?? 0));
  return info.changes ? json({ ok: true }) : json({ error: "Not found" }, 404);
};

export const DELETE: APIRoute = ({ params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const info = db.prepare("DELETE FROM reviews WHERE id = ?").run(Number(params.id ?? 0));
  return info.changes ? json({ ok: true }) : json({ error: "Not found" }, 404);
};
