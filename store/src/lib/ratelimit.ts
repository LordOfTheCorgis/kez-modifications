/** In-memory sliding-window rate limiter. Good enough for a single node process. */
const buckets = new Map<string, number[]>();

const MAX_TRACKED_KEYS = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  if (buckets.size > MAX_TRACKED_KEYS) buckets.clear();
  buckets.set(key, hits);
  return true;
}
