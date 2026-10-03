import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import type { StaffRoleRow } from "../../../lib/db";
import { json, requireOwner, requirePerm } from "../../../lib/admin";
import { parsePerms, SECTIONS } from "../../../lib/perms";

// Users-view folks need the role names for the list; only the owner edits them
export const GET: APIRoute = ({ locals }) => {
  const denied = requirePerm(locals, "users", 1);
  if (denied) return denied;
  const roles = db.prepare("SELECT * FROM staff_roles ORDER BY name").all() as StaffRoleRow[];
  const counts = new Map(
    (
      db.prepare("SELECT staff_role_id AS id, COUNT(*) AS n FROM users WHERE staff_role_id IS NOT NULL GROUP BY staff_role_id").all() as {
        id: number;
        n: number;
      }[]
    ).map((r) => [r.id, r.n]),
  );
  return json({
    roles: roles.map((r) => ({ id: r.id, name: r.name, perms: parsePerms(r.perms), members: counts.get(r.id) ?? 0 })),
    sections: SECTIONS,
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireOwner(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { name?: unknown; perms?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : "";
  if (!name) return json({ error: "Name the role" }, 400);
  try {
    const info = db
      .prepare("INSERT INTO staff_roles (name, perms) VALUES (?, ?)")
      .run(name, JSON.stringify(parsePerms(b?.perms)));
    return json({ id: Number(info.lastInsertRowid) });
  } catch {
    return json({ error: "A role with that name already exists" }, 409);
  }
};
