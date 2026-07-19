import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { json } from "../../lib/admin";
import { rateLimit } from "../../lib/ratelimit";

const MAX_MESSAGE_LENGTH = 1000;
const MIN_MESSAGE_LENGTH = 10;

/** Signed-in users leave one review each; resubmitting replaces it and re-enters moderation. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in to leave a review" }, 401);
  if (!rateLimit(`review:${user.id}`, 3, 10 * 60_000)) {
    return json({ error: "Too many attempts, try again later" }, 429);
  }

  const b = (await request.json().catch(() => null)) as { rating?: unknown; message?: unknown } | null;
  const rating = Number(b?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ error: "Pick a star rating" }, 400);
  }
  const message = typeof b?.message === "string" ? b.message.trim() : "";
  if (message.length < MIN_MESSAGE_LENGTH) {
    return json({ error: "Tell us a little more (at least 10 characters)" }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: "Review is too long (1000 characters max)" }, 400);
  }

  db.prepare(
    `INSERT INTO reviews (user_id, rating, message, is_approved)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(user_id) DO UPDATE SET
       rating = excluded.rating,
       message = excluded.message,
       is_approved = 0,
       created_at = datetime('now')`,
  ).run(user.id, rating, message);

  return json({ ok: true });
};
