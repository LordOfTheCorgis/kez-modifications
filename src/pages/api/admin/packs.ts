import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const packs = db
    .prepare(
      `SELECT p.*, c.name AS category_name,
         (SELECT COUNT(*) FROM orders o WHERE o.pack_id = p.id AND o.status = 'paid') AS sales
       FROM packs p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.sort_order, p.id`,
    )
    .all();
  const images = db.prepare("SELECT * FROM pack_images ORDER BY sort_order, id").all();
  return json({ packs, images });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.name !== "string" || !b.name.trim()) return json({ error: "name required" }, 400);
  const price = Math.max(0, Math.round(Number(b.price ?? 0)));
  if (!Number.isFinite(price)) return json({ error: "invalid price" }, 400);

  const info = db
    .prepare(
      `INSERT INTO packs (name, description, price, image_url, file_url, category_id, discord_role_id,
         grants_all_access, is_featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM packs))`,
    )
    .run(
      b.name.trim(),
      typeof b.description === "string" ? b.description : "",
      price,
      typeof b.image_url === "string" && b.image_url ? b.image_url : null,
      typeof b.file_url === "string" && b.file_url ? b.file_url : null,
      b.category_id ? Number(b.category_id) : null,
      typeof b.discord_role_id === "string" && b.discord_role_id ? b.discord_role_id : null,
      b.grants_all_access ? 1 : 0,
      b.is_featured ? 1 : 0,
    );
  const packId = Number(info.lastInsertRowid);
  if (Array.isArray(b.gallery)) {
    const ins = db.prepare("INSERT INTO pack_images (pack_id, url, sort_order) VALUES (?, ?, ?)");
    (b.gallery as string[]).forEach((url, i) => {
      if (typeof url === "string" && url) ins.run(packId, url, i);
    });
  }
  return json({ id: packId });
};
