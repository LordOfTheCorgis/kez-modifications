import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import { json, requireOwner } from "../../../../lib/admin";
import { parsePerms } from "../../../../lib/perms";

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const denied = requireOwner(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { name?: unknown; perms?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : "";
  if (!name) return json({ error: "Name the role" }, 400);
  try {
    const info = db
      .prepare("UPDATE staff_roles SET name = ?, perms = ? WHERE id = ?")
      .run(name, JSON.stringify(parsePerms(b?.perms)), Number(params.id ?? 0));
    if (!info.changes) return json({ error: "Not found" }, 404);
  } catch {
    return json({ error: "A role with that name already exists" }, 409);
  }
  return json({ ok: true });
};

/** Members fall back to no role (FK is ON DELETE SET NULL), so they lose access unless they have overrides. */
export const DELETE: APIRoute = ({ params, locals }) => {
  const denied = requireOwner(locals);
  if (denied) return denied;
  // foreign_keys pragma is on, but be explicit, this is the one that matters
  db.prepare("UPDATE users SET staff_role_id = NULL WHERE staff_role_id = ?").run(Number(params.id ?? 0));
  db.prepare("DELETE FROM staff_roles WHERE id = ?").run(Number(params.id ?? 0));
  return json({ ok: true });
};
