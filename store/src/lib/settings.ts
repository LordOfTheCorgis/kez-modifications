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

/** tier name -> settings key holding the Discord role id for that tier */
export function getTierRoleId(tier: string): string {
  const safe = tier.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return getSetting(`role_id_${safe}`);
}

export function getTierPriceId(tier: string): string {
  const safe = tier.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return getSetting(`stripe_price_${safe}`);
}

export function getSiteUrl(): string {
  const url = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  return url.replace(/\/+$/, "");
}
