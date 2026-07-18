# Kez Modifications — Store

Astro 5 (SSR, `@astrojs/node` standalone) storefront selling digital FiveM packs,
delivered by granting Discord roles. Payments via Stripe Checkout. Products,
pricing, categories, discounts, Stripe keys, and role mappings are all
admin-configurable at `/admin` — nothing product-specific is hardcoded.

## Run

```bash
npm install
cp .env.example .env   # fill in the values below
npm run dev            # http://localhost:4321
npm run build && npm start   # production (node ./dist/server/entry.mjs)
```

## Environment

| Var | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL` | Canonical origin. Stripe success_url and OAuth redirects are built from this, never from the request host. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth app (redirect URI: `{PUBLIC_SITE_URL}/api/auth/callback`). |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` | Fallback only — set these in `/admin` → Settings instead. |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord ids that are always admins (bootstrap: put your id here, sign in, then manage staff in the UI). |
| `DATA_DIR` | SQLite db + uploads. Defaults to `./data`. Back this directory up. |

The bot must be in your guild with **Manage Roles**, and its highest role must
sit **above** every role it grants.

## Configuration (in /admin → Settings)

- Stripe mode toggle (test/live) with separate secret + webhook secret per mode.
- Discord bot token + guild id (rotatable without redeploy).
- Notification webhooks: `webhook_sales`, `webhook_log`, `webhook_discounts`.
- Subscription tiers: `role_id_<tier>` + `stripe_price_<tier>` pairs
  (gold/platinum shipped in the UI; any tier name works via the API).

Stripe webhook endpoint: `POST {PUBLIC_SITE_URL}/api/stripe/webhook` with events
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`. Fulfillment is dual-path (browser callback +
webhook), idempotent on the order's pending→paid transition, so replayed
webhooks never double-fulfill.

## Verify end-to-end (needs test credentials)

1. `npm run build` — passes (also `npx astro check`: 0 errors).
2. Sign in via Discord OAuth; confirm your account page loads.
3. Create a category + pack in `/admin` with a role from the live role picker.
4. Buy it with card `4242 4242 4242 4242` → role granted, order `paid`,
   sales webhook fires, file downloads from the account page.
5. `stripe events resend <evt>` (or Stripe CLI `trigger checkout.session.completed`)
   → order stays `paid`, no second role grant or discount increment.
6. Set the pack price to 0 → "Claim" flow grants the role with no Stripe call.
7. Create a discount code, apply at purchase; server recomputes the price and
   increments `uses` exactly once.

## Security notes

- Sessions: 256-bit tokens stored sha256-hashed; cookie httpOnly/secure/lax.
- Middleware CSRF origin check on all state-changing requests (plus Astro's
  built-in form-post origin check); rate limits on `/api/auth/*`, `/api/purchase`,
  `/api/subscribe`.
- Product files live in `DATA_DIR/files` (never web-served); downloads go
  through `/api/download/[packId]` which checks paid order / owned role /
  all-access and logs each download.
- Prices always computed server-side from the DB row; discounts validated
  server-side (active, window, max uses).
- Stripe secrets are per-mode, stored in the settings table, masked in the
  admin API, never logged.
