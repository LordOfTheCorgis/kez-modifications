import { can, SECTIONS } from "./perms";
import type { Level, Section } from "./perms";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/**
 * Per-section gate. GETs pass `1` (view), anything that changes data passes `2`.
 * Takes a list when a route serves more than one page, e.g. the orders page
 * needs the pack list for its grant picker.
 */
export function requirePerm(locals: App.Locals, sections: Section | Section[], level: Level): Response | null {
  if (!locals.user) return json({ error: "Not signed in" }, 401);
  const list = Array.isArray(sections) ? sections : [sections];
  if (list.some((s) => can(locals.user, s, level))) return null;
  const what = list.map((s) => SECTIONS[s]).join(" or ");
  console.error(`[admin] 403 — ${locals.user.name} lacks ${level === 2 ? "edit" : "view"} on ${what}`);
  return json({ error: `You need ${level === 2 ? "edit" : "view"} access to ${what}` }, 403);
}

/** Staff management. Owner only, never grantable. */
export function requireOwner(locals: App.Locals): Response | null {
  if (!locals.user) return json({ error: "Not signed in" }, 401);
  if (!locals.user.isOwner) return json({ error: "Only the owner can manage staff" }, 403);
  return null;
}
