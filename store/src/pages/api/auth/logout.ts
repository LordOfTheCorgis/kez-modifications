import type { APIRoute } from "astro";
import { destroySession, SESSION_COOKIE } from "../../../lib/session";

export const POST: APIRoute = ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return new Response(null, { status: 302, headers: { Location: "/" } });
};
