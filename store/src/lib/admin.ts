export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Server-side admin gate for API routes. Returns a Response to short-circuit with, or null. */
export function requireAdmin(locals: App.Locals): Response | null {
  if (!locals.user) return json({ error: "Not signed in" }, 401);
  if (!locals.user.isAdmin) return json({ error: "Admin only" }, 403);
  return null;
}
