import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, resolveSession, destroySessionsForUser } from "./lib/session";
import { getGuildMember } from "./lib/discord";
import { getSiteUrl } from "./lib/settings";

const roleCache = new Map<number, { roles: string[]; at: number }>();
const ROLE_CACHE_MS = 60_000;

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, request, url } = context;

  // CSRF: state-changing requests must originate from our own origin.
  // Server-to-server posts (Stripe webhooks) carry no Origin header and pass.
  if (STATE_CHANGING.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin && origin !== getSiteUrl()) {
      return new Response("Cross-origin request rejected", { status: 403 });
    }
  }

  context.locals.user = null;
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const user = resolveSession(token);
    if (!user) {
      cookies.delete(SESSION_COOKIE, { path: "/" });
    } else if (user.is_banned) {
      destroySessionsForUser(user.id);
      cookies.delete(SESSION_COOKIE, { path: "/" });
    } else {
      let cached = roleCache.get(user.id);
      if (!cached || Date.now() - cached.at > ROLE_CACHE_MS) {
        const member = await getGuildMember(user.discord_id);
        cached = { roles: member?.roles ?? cached?.roles ?? [], at: Date.now() };
        roleCache.set(user.id, cached);
      }
      const bootstrapAdmins = (process.env.ADMIN_DISCORD_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      context.locals.user = {
        id: user.id,
        discordId: user.discord_id,
        name: user.name,
        image: user.image,
        isAdmin: user.is_admin === 1 || bootstrapAdmins.includes(user.discord_id),
        discordRoles: cached.roles,
      };
    }
  }
  return next();
});
