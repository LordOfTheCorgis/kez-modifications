import type { APIRoute } from "astro";
import { getGuildRoles } from "../../../lib/discord";
import { json, requirePerm } from "../../../lib/admin";

/** Live guild roles for the admin role picker (never free text). */
export const GET: APIRoute = async ({ locals }) => {
  const denied = requirePerm(locals, "products", 1);
  if (denied) return denied;
  const roles = await getGuildRoles();
  return json({ roles: roles.map((r) => ({ id: r.id, name: r.name, managed: r.managed })) });
};
