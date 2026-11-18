import type { APIRoute } from "astro";
import { db } from "../../../../../lib/db";
import { json, requirePerm } from "../../../../../lib/admin";

const list = (packId: number) =>
  db.prepare("SELECT * FROM pack_versions WHERE pack_id = ? ORDER BY released_on DESC, id DESC").all(packId);

export const GET: APIRoute = ({ params, locals }) => {
  const denied = requirePerm(locals, "products", 1);
  if (denied) return denied;
  return json({ versions: list(Number(params.id ?? 0)) });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const denied = requirePerm(locals, "products", 2);
  if (denied) return denied;
  const packId = Number(params.id ?? 0);
  if (!db.prepare("SELECT 1 FROM packs WHERE id = ?").get(packId)) return json({ error: "Pack not found" }, 404);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const version = typeof b?.version === "string" ? b.version.trim().slice(0, 40) : "";
  if (!version) return json({ error: "Version required" }, 400);
  const notes = typeof b?.notes === "string" ? b.notes.slice(0, 5000) : "";
  // anything that isn't a real date falls back to today rather than erroring
  const date = typeof b?.released_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.released_on) ? b.released_on : null;
  db.prepare(
    "INSERT INTO pack_versions (pack_id, version, notes, released_on) VALUES (?, ?, ?, COALESCE(?, date('now')))",
  ).run(packId, version, notes, date);
  return json({ versions: list(packId) });
};

/** ?vid=<version id>. No edit, delete and re-add is fine for a typo. */
export const DELETE: APIRoute = ({ params, url, locals }) => {
  const denied = requirePerm(locals, "products", 2);
  if (denied) return denied;
  const packId = Number(params.id ?? 0);
  db.prepare("DELETE FROM pack_versions WHERE id = ? AND pack_id = ?").run(Number(url.searchParams.get("vid") ?? 0), packId);
  return json({ versions: list(packId) });
};
