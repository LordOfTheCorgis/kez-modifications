import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import {
  getSetting,
  setSetting,
  maskSecret,
  stripeKeyProblem,
  SECRET_SETTING_KEYS,
} from "../../../lib/settings";
import { json, requireAdmin } from "../../../lib/admin";

const ALLOWED_KEY = /^[a-z0-9_]{1,64}$/;

/** GET returns settings with secrets masked; POST updates (empty secret = keep current). */
export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const rows = db.prepare("SELECT key FROM settings").all() as { key: string }[];
  const keys = new Set<string>([
    ...rows.map((r) => r.key),
    "stripe_mode",
    "stripe_test_secret_key",
    "stripe_test_webhook_secret",
    "stripe_live_secret_key",
    "stripe_live_webhook_secret",
    "discord_guild_id",
    "webhook_sales",
    "webhook_log",
    "webhook_discounts",
    "discord_invite_url",
  ]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = getSetting(key);
    // Secrets show a fingerprint (prefix + last 4) so an admin can verify which
    // key landed in which slot without the value ever leaving the server intact.
    out[key] = SECRET_SETTING_KEYS.has(key) ? maskSecret(value) : value;
  }
  return json({ settings: out });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return json({ error: "invalid body" }, 400);
  const pending: [string, string][] = [];
  for (const [key, raw] of Object.entries(b)) {
    if (!ALLOWED_KEY.test(key) || typeof raw !== "string") continue;
    const value = raw.trim();
    // A masked/blank secret field means "leave unchanged".
    if (SECRET_SETTING_KEYS.has(key) && (value === "" || value.includes("•"))) continue;
    if (key === "stripe_mode" && value !== "test" && value !== "live") continue;

    // Reject a malformed key at save time. Storing it silently is what made the
    // failure only surface later, at checkout, as an unexplained error.
    const mode = key === "stripe_test_secret_key" ? "test" : key === "stripe_live_secret_key" ? "live" : null;
    if (mode) {
      const problem = stripeKeyProblem(value, mode);
      if (problem) return json({ error: problem }, 400);
    }
    if (key.endsWith("_webhook_secret") && !value.startsWith("whsec_")) {
      return json({ error: "A webhook signing secret must start with whsec_." }, 400);
    }
    pending.push([key, value]);
  }
  // Nothing is written unless every field validated, so a rejected save never
  // leaves the settings half-applied.
  for (const [key, value] of pending) setSetting(key, value);
  return json({ ok: true });
};
