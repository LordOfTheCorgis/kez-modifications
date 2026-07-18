import { getSetting } from "./settings";

export type NotifyChannel = "sales" | "log" | "discounts";

/**
 * Posts to the Discord webhook configured for the given channel
 * (settings keys webhook_sales / webhook_log / webhook_discounts).
 * Fire-and-forget: notification failures must never break fulfillment.
 */
export async function logToDiscord(message: string, channel: NotifyChannel = "log"): Promise<void> {
  const url = getSetting(`webhook_${channel}`);
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1900) }),
    });
  } catch (err) {
    console.error(`[notify] webhook post to '${channel}' failed`, err);
  }
}
