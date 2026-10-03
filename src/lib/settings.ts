import { db } from "./db";

/**
 * Settings live in the DB so admins can rotate keys without a redeploy.
 * Env vars act only as a fallback for the keys listed in ENV_FALLBACKS.
 */
const ENV_FALLBACKS: Record<string, string | undefined> = {
  discord_bot_token: process.env.DISCORD_BOT_TOKEN,
  discord_guild_id: process.env.DISCORD_GUILD_ID,
};

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setStmt = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

export function getSetting(key: string): string {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (row && row.value !== "") return row.value;
  return ENV_FALLBACKS[key] ?? "";
}

export function setSetting(key: string, value: string): void {
  setStmt.run(key, value);
}

/** Keys whose values must never be echoed back to the client. */
export const SECRET_SETTING_KEYS = new Set([
  "stripe_test_secret_key",
  "stripe_test_webhook_secret",
  "stripe_live_secret_key",
  "stripe_live_webhook_secret",
  "discord_bot_token",
]);

export type StripeMode = "test" | "live";

export function getStripeMode(): StripeMode {
  return getSetting("stripe_mode") === "live" ? "live" : "test";
}

export function getStripeSecretKey(mode = getStripeMode()): string {
  return getSetting(`stripe_${mode}_secret_key`);
}

export function getStripeWebhookSecret(mode = getStripeMode()): string {
  return getSetting(`stripe_${mode}_webhook_secret`);
}

export function getSiteUrl(): string {
  const url = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  return url.replace(/\/+$/, "");
}

/**
 * Homepage slideshow images, stored as a JSON array under hero_slides. Only
 * our own uploads or https urls get through, so a bad paste can't inject
 * something weird into a style/src attribute.
 */
export function getHeroSlides(): string[] {
  try {
    const parsed = JSON.parse(getSetting("hero_slides") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u): u is string => typeof u === "string" && (/^\/uploads\/[\w.-]+$/.test(u) || /^https:\/\/\S+$/.test(u)),
    );
  } catch {
    return [];
  }
}
