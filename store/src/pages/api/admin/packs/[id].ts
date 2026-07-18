import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { db, PRIVATE_FILES_DIR, PUBLIC_UPLOADS_DIR } from "../../../../lib/db";
import type { PackImageRow, PackRow } from "../../../../lib/db";
import { json, requireAdmin } from "../../../../lib/admin";

function getPack(id: string | undefined): PackRow | undefined {
  return db.prepare("SELECT * FROM packs WHERE id = ?").get(Number(id ?? 0)) as PackRow | undefined;
}

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const pack = getPack(params.id);
  if (!pack) return json({ error: "Not found" }, 404);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.name !== "string" || !b.name.trim()) return json({ error: "name required" }, 400);
  const price = Math.max(0, Math.round(Number(b.price ?? 0)));
  if (!Number.isFinite(price)) return json({ error: "invalid price" }, 400);

  db.prepare(
    `UPDATE packs SET name = ?, description = ?, price = ?, image_url = ?, file_url = ?,
       category_id = ?, discord_role_id = ?, grants_all_access = ?, is_featured = ? WHERE id = ?`,
  ).run(
    b.name.trim(),
    typeof b.description === "string" ? b.description : "",
    price,
    typeof b.image_url === "string" && b.image_url ? b.image_url : null,
    typeof b.file_url === "string" && b.file_url ? b.file_url : pack.file_url,
    b.category_id ? Number(b.category_id) : null,
    typeof b.discord_role_id === "string" && b.discord_role_id ? b.discord_role_id : null,
    b.grants_all_access ? 1 : 0,
    b.is_featured ? 1 : 0,
    pack.id,
  );

  if (Array.isArray(b.gallery)) {
    db.prepare("DELETE FROM pack_images WHERE pack_id = ?").run(pack.id);
    const ins = db.prepare("INSERT INTO pack_images (pack_id, url, sort_order) VALUES (?, ?, ?)");
    (b.gallery as string[]).forEach((url, i) => {
      if (typeof url === "string" && url) ins.run(pack.id, url, i);
    });
  }
  return json({ ok: true });
};

/** Cascade: uploaded files first, then pack_images / download_logs / orders rows, then the pack. */
export const DELETE: APIRoute = ({ params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const pack = getPack(params.id);
  if (!pack) return json({ error: "Not found" }, 404);

  const images = db
    .prepare("SELECT * FROM pack_images WHERE pack_id = ?")
    .all(pack.id) as PackImageRow[];
  const imageUrls = new Set<string>([...(pack.image_url ? [pack.image_url] : []), ...images.map((i) => i.url)]);
  for (const url of imageUrls) {
    if (url.startsWith("/uploads/")) {
      const p = path.join(PUBLIC_UPLOADS_DIR, path.basename(url));
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (err) {
        console.error("[admin] failed to delete image", p, err);
      }
    }
  }
  if (pack.file_url) {
    const p = path.join(PRIVATE_FILES_DIR, path.basename(pack.file_url));
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      console.error("[admin] failed to delete product file", p, err);
    }
  }

  db.transaction(() => {
    db.prepare("DELETE FROM pack_images WHERE pack_id = ?").run(pack.id);
    db.prepare("DELETE FROM download_logs WHERE pack_id = ?").run(pack.id);
    db.prepare("DELETE FROM orders WHERE pack_id = ?").run(pack.id);
    db.prepare("DELETE FROM packs WHERE id = ?").run(pack.id);
  })();
  return json({ ok: true });
};
