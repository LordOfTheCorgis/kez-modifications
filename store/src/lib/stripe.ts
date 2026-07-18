import Stripe from "stripe";
import { getStripeMode, getStripeSecretKey, type StripeMode } from "./settings";

const clients = new Map<string, Stripe>();

/** Returns a Stripe client for the current (or given) mode, or null if unconfigured. */
export function getStripe(mode?: StripeMode): Stripe | null {
  const m = mode ?? getStripeMode();
  const key = getStripeSecretKey(m);
  if (!key) return null;
  let client = clients.get(key);
  if (!client) {
    client = new Stripe(key);
    clients.set(key, client);
  }
  return client;
}
