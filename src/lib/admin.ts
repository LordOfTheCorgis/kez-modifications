export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Server-side admin gate for API routes. Returns a Response to short-circuit with, or null. */
export function requireAdmin(locals: App.Locals): Response | null {
  if (!locals.user) {
    console.error("[admin] 401 — no session on an admin-gated route");
    return json({ error: "Not signed in" }, 401);
  }
  if (!locals.user.isAdmin) {
    console.error(
      `[admin] 403 — discord ${locals.user.discordId} ('${locals.user.name}') is not an admin; set users.is_admin=1 or add the id to ADMIN_DISCORD_IDS`,
    );
    return json({ error: "Admin only" }, 403);
  }
  return null;
}
