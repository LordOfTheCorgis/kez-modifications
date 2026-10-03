import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { getSetting, setSetting, SECRET_SETTING_KEYS } from "../../../lib/settings";
import { json, requirePerm } from "../../../lib/admin";
import { can } from "../../../lib/perms";
import type { Level } from "../../../lib/perms";

// the commissions page stores its stuff in settings too, but someone with
// Commissions access shouldn't get to read Stripe keys on the way
const sectionFor = (key: string) => (key.startsWith("commissions_") ? "commissions" : "settings");
const allowed = (locals: App.Locals, key: string, level: Level) => can(locals.user, sectionFor(key), level);

const ALLOWED_KEY = /^[a-z0-9_]{1,64}$/;

/** GET returns settings with secrets masked; POST updates (empty secret = keep current). */
export const GET: APIRoute = ({ locals }) => {
  const denied = requirePerm(locals, ["settings", "commissions"], 1);
  if (denied) return denied;
  const rows = db.prepare("SELECT key FROM settings").all() as { key: string }[];
  const keys = new Set<string>([
    ...rows.map((r) => r.key),
    "stripe_mode",
    "stripe_test_secret_key",
    "stripe_test_webhook_secret",
    "stripe_live_secret_key",
    "stripe_live_webhook_secret",
    "discord_bot_token",
    "discord_guild_id",
    "webhook_sales",
    "webhook_log",
    "webhook_discounts",
    "discord_invite_url",
    "contact_email",
    "hero_slides",
  ]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!allowed(locals, key, 1)) continue;
    const value = getSetting(key);
    out[key] = SECRET_SETTING_KEYS.has(key) ? (value ? "••••• (set)" : "") : value;
  }
  return json({ settings: out });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requirePerm(locals, ["settings", "commissions"], 2);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return json({ error: "invalid body" }, 400);
  for (const [key, raw] of Object.entries(b)) {
    if (!ALLOWED_KEY.test(key) || typeof raw !== "string") continue;
    if (!allowed(locals, key, 2)) return json({ error: `No edit access for ${key}` }, 403);
    const value = raw.trim();
    // A masked/blank secret field means "leave unchanged".
    if (SECRET_SETTING_KEYS.has(key) && (value === "" || value.startsWith("•"))) continue;
    if (key === "stripe_mode" && value !== "test" && value !== "live") continue;
    setSetting(key, value);
  }
  return json({ ok: true });
};
