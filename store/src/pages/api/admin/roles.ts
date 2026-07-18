import type { APIRoute } from "astro";
import { getGuildRoles } from "../../../lib/discord";
import { json, requireAdmin } from "../../../lib/admin";

/** Live guild roles for the admin role picker (never free text). */
export const GET: APIRoute = async ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const roles = await getGuildRoles();
  return json({ roles: roles.map((r) => ({ id: r.id, name: r.name, managed: r.managed })) });
};
