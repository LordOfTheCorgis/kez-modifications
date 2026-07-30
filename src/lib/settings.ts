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

/**
 * Shows enough of a secret to confirm which key is stored (prefix + last 4)
 * without revealing it. Mirrors how Stripe's own dashboard displays keys.
 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length < 16) return "•••• (set)";
  const prefix = /^((?:sk|rk|pk)_(?:test|live)_|whsec_)/.exec(value);
  return `${prefix ? prefix[1] : value.slice(0, 4)}••••${value.slice(-4)}`;
}

/**
 * Validates the shape of a Stripe secret key for a given mode.
 * Returns a human-readable problem, or null if the key looks usable.
 * Pure string checks only — no network call, no Stripe import (keeps this
 * usable from both the admin save path and the checkout path).
 */
export function stripeKeyProblem(key: string, mode: StripeMode): string | null {
  if (!key) return `No ${mode} secret key is saved.`;
  if (key.startsWith("pk_"))
    return "That is a publishable key. Use the secret key (sk_) or a restricted key (rk_) instead.";
  if (key.startsWith("whsec_"))
    return "That is a webhook signing secret. It belongs in the webhook secret field, not the API key field.";
  if (!/^(sk|rk)_(test|live)_/.test(key))
    return "That does not look like a Stripe API key — it should start with sk_test_, sk_live_, rk_test_, or rk_live_.";
  const keyMode = key.includes("_live_") ? "live" : "test";
  if (keyMode !== mode)
    return `That is a ${keyMode} key, but it was entered in the ${mode} field. Put it in the ${keyMode} field instead.`;
  return null;
}

export function getSiteUrl(): string {
  const url = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
  return url.replace(/\/+$/, "");
}
