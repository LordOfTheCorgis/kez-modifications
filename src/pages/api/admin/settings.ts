import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { getSetting, setSetting, SECRET_SETTING_KEYS } from "../../../lib/settings";
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
  ]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = getSetting(key);
    out[key] = SECRET_SETTING_KEYS.has(key) ? (value ? "••••• (set)" : "") : value;
  }
  return json({ settings: out });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return json({ error: "invalid body" }, 400);
  for (const [key, raw] of Object.entries(b)) {
    if (!ALLOWED_KEY.test(key) || typeof raw !== "string") continue;
    const value = raw.trim();
    // A masked/blank secret field means "leave unchanged".
    if (SECRET_SETTING_KEYS.has(key) && (value === "" || value.startsWith("•"))) continue;
    if (key === "stripe_mode" && value !== "test" && value !== "live") continue;
    setSetting(key, value);
  }
  return json({ ok: true });
};
