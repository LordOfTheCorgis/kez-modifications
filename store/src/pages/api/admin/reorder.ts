import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";

const TABLES: Record<string, string> = { packs: "packs", categories: "categories" };

/** Persists drag-to-reorder: body { table, ids } where ids is the new visual order. */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { table?: string; ids?: number[] } | null;
  const table = TABLES[b?.table ?? ""];
  if (!table || !Array.isArray(b?.ids)) return json({ error: "table and ids required" }, 400);
  const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  db.transaction(() => {
    b.ids!.forEach((id, i) => update.run(i, Number(id)));
  })();
  return json({ ok: true });
};
