import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import type { UserRow } from "../../../lib/db";
import { exchangeCode, fetchDiscordUser } from "../../../lib/discord";
import { getSiteUrl } from "../../../lib/settings";
import { createSession, SESSION_COOKIE } from "../../../lib/session";
import { rateLimit } from "../../../lib/ratelimit";

export const GET: APIRoute = async ({ cookies, url, clientAddress }) => {
  let ip = "unknown";
  try {
    ip = clientAddress;
  } catch {
    /* ignore */
  }
  if (!rateLimit(`auth:${ip}`, 10, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const fail = (reason: string) =>
    new Response(null, { status: 302, headers: { Location: `/?login_error=${reason}` } });

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expected = cookies.get("kez_oauth_state")?.value;
  cookies.delete("kez_oauth_state", { path: "/" });
  if (!state || !code || !expected || state !== expected) return fail("state");

  const accessToken = await exchangeCode(code, `${getSiteUrl()}/api/auth/callback`);
  if (!accessToken) return fail("exchange");

  const discordUser = await fetchDiscordUser(accessToken);
  if (!discordUser) return fail("profile");

  const name = discordUser.global_name || discordUser.username;
  const image = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
    : null;

  db.prepare(
    `INSERT INTO users (discord_id, name, email, image) VALUES (?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET name = excluded.name, email = excluded.email, image = excluded.image`,
  ).run(discordUser.id, name, discordUser.email, image);

  const user = db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordUser.id) as UserRow;
  if (user.is_banned) return fail("banned");

  const { token, expiresAt } = createSession(user.id);
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: getSiteUrl().startsWith("https"),
    sameSite: "lax",
    expires: expiresAt,
  });

  const next = cookies.get("kez_oauth_next")?.value ?? "/";
  cookies.delete("kez_oauth_next", { path: "/" });
  return new Response(null, {
    status: 302,
    headers: { Location: next.startsWith("/") && !next.startsWith("//") ? next : "/" },
  });
};
