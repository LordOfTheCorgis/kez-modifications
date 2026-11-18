import { getSetting } from "./settings";

export type NotifyChannel = "sales" | "log" | "discounts" | "support";

/** Optional extras for a richer embed. Most callers just send a string. */
export interface EmbedExtra {
  fields?: { name: string; value: string; inline?: boolean }[];
  url?: string;
  color?: number;
}

// a broken config (bad webhook secret, dead bot token) fails on every single
// request, and 200 identical pings in the log channel bury the one that matters
const DEDUPE_MS = 60_000;
const lastSent = new Map<string, number>();

// every caller already leads with an emoji that says what kind of message it
// is, so that picks the color + title instead of threading a "kind" arg through 15 call sites
const KINDS: Record<string, { color: number; title: string }> = {
  ":rotating_light:": { color: 0xe5484d, title: "Needs attention" },
  ":warning:": { color: 0xf5a524, title: "Warning" },
  ":moneybag:": { color: 0x30a46c, title: "New sale" },
  ":gift:": { color: 0x30a46c, title: "Pack granted" },
  ":white_check_mark:": { color: 0x30a46c, title: "Fixed" },
  ":label:": { color: 0xd6a84e, title: "Discount" },
  ":rocket:": { color: 0x8e4ec6, title: "Pack released" },
  ":no_entry:": { color: 0x8b8d98, title: "Access revoked" },
  ":ticket:": { color: 0x3e8ef7, title: "Support ticket" },
};
const FALLBACK: Record<NotifyChannel, { color: number; title: string }> = {
  sales: { color: 0x30a46c, title: "Sales" },
  log: { color: 0x3e8ef7, title: "Store log" },
  discounts: { color: 0xd6a84e, title: "Discount" },
  support: { color: 0x3e8ef7, title: "Support ticket" },
};

export function toEmbed(message: string, channel: NotifyChannel, extra: EmbedExtra = {}) {
  const emoji = message.match(/^:[a-z_]+:/)?.[0] ?? "";
  const kind = KINDS[emoji] ?? FALLBACK[channel];
  return {
    title: kind.title,
    description: message.slice(emoji.length).trim().slice(0, 4000),
    color: extra.color ?? kind.color,
    ...(extra.url ? { url: extra.url } : {}),
    // discord caps field values at 1024 and rejects the whole embed past that
    ...(extra.fields ? { fields: extra.fields.slice(0, 25).map((f) => ({ ...f, value: f.value.slice(0, 1024) || "—" })) } : {}),
    footer: { text: "Kez Modifications" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Posts to the Discord webhook configured for the given channel
 * (settings keys webhook_sales / webhook_log / webhook_discounts).
 * Fire-and-forget: notification failures must never break fulfillment.
 * Every log-channel message also goes to stdout, so nothing is lost if the
 * webhook is down or rate limited.
 */
export async function logToDiscord(message: string, channel: NotifyChannel = "log", extra?: EmbedExtra): Promise<void> {
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
  const body = JSON.stringify({ embeds: [toEmbed(message, channel, extra)] });
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
  // stripe's errors come with a paragraph of docs links attached, first line is the useful part
  return (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);
}
