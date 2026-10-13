import { getSetting } from "./settings";

export type NotifyChannel = "sales" | "log" | "discounts";

// a broken config (bad webhook secret, dead bot token) fails on every single
// request, and 200 identical pings in the log channel bury the one that matters
const DEDUPE_MS = 60_000;
const lastSent = new Map<string, number>();

/**
 * Posts to the Discord webhook configured for the given channel
 * (settings keys webhook_sales / webhook_log / webhook_discounts).
 * Fire-and-forget: notification failures must never break fulfillment.
 * Every log-channel message also goes to stdout, so nothing is lost if the
 * webhook is down or rate limited.
 */
export async function logToDiscord(message: string, channel: NotifyChannel = "log"): Promise<void> {
  if (channel === "log") {
    console.error(`[log] ${message}`);
    const now = Date.now();
    if (now - (lastSent.get(message) ?? 0) < DEDUPE_MS) return;
    lastSent.set(message, now);
    // ponytail: unbounded-ish map, pruned whenever it gets big. fine at this traffic
    if (lastSent.size > 500) for (const [k, t] of lastSent) if (now - t > DEDUPE_MS) lastSent.delete(k);
  }
  const url = getSetting(`webhook_${channel}`);
  if (!url) return;
  const body = JSON.stringify({ content: message.slice(0, 1900) });
  try {
    let res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    // discord webhooks cap around 30/min. a launch rush can hit that on the
    // sales feed, so honor retry_after once instead of silently dropping it
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    }
    if (!res.ok) console.error(`[notify] '${channel}' webhook returned ${res.status}, message was: ${message}`);
  } catch (err) {
    console.error(`[notify] webhook post to '${channel}' failed, message was: ${message}`, err);
  }
}

/** Error -> one readable line for a Discord message. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
