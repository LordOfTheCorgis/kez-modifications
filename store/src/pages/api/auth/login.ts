import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { buildAuthorizeUrl } from "../../../lib/discord";
import { getSiteUrl } from "../../../lib/settings";
import { rateLimit } from "../../../lib/ratelimit";

export const GET: APIRoute = ({ cookies, url, clientAddress }) => {
  let ip = "unknown";
  try {
    ip = clientAddress;
  } catch {
    /* not available behind some setups */
  }
  if (!rateLimit(`auth:${ip}`, 10, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  cookies.set("kez_oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: getSiteUrl().startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
  });

  const next = url.searchParams.get("next") ?? "/";
  cookies.set("kez_oauth_next", next.startsWith("/") && !next.startsWith("//") ? next : "/", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
  });

  const redirectUri = `${getSiteUrl()}/api/auth/callback`;
  return new Response(null, {
    status: 302,
    headers: { Location: buildAuthorizeUrl(redirectUri, state) },
  });
};
