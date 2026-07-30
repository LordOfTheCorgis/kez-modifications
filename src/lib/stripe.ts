import Stripe from "stripe";
import {
  getStripeMode,
  getStripeSecretKey,
  stripeKeyProblem,
  type StripeMode,
} from "./settings";

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

/**
 * Human-readable reason the saved Stripe config cannot be used, or null if it looks usable.
 * Catches the common setup mistakes (publishable key pasted, live key in the test slot)
 * before a request is ever sent to Stripe.
 */
export function getStripeConfigError(mode?: StripeMode): string | null {
  const m = mode ?? getStripeMode();
  const problem = stripeKeyProblem(getStripeSecretKey(m), m);
  return problem ? `${problem} (Admin → Settings, Stripe is in ${m} mode.)` : null;
}

/** Stripe keys are redacted defensively; Stripe already masks them, but never rely on that. */
const KEY_PATTERN = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g;

/** Turns a thrown Stripe/unknown error into a safe, actionable message for the buyer. */
export function stripeErrorMessage(err: unknown): string {
  let raw: string;
  if (err instanceof Stripe.errors.StripeError) {
    raw =
      err.type === "StripeAuthenticationError"
        ? "the API key was rejected — check that it is correct, still active, and matches the selected mode"
        : err.message;
  } else if (err instanceof Error) {
    raw = err.message;
  } else {
    raw = "unknown error";
  }
  return raw.replace(KEY_PATTERN, "[redacted]");
}
