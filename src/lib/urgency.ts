import type Database from "better-sqlite3";

/** The only four urgencies tickets are allowed to have. Order is severity, low to high. */
export const URGENCY_KEYS = ["low", "normal", "high", "urgent"] as const;
export type UrgencyKey = (typeof URGENCY_KEYS)[number];

// Everything the old form could have stored, plus the words people (and future
// me) would plausibly have typed into the db by hand. Closest meaning wins.
const SYNONYMS: Record<string, UrgencyKey> = {
  low: "low", minor: "low", trivial: "low", whenever: "low", lowest: "low", p3: "low", p4: "low", question: "low",
  normal: "normal", medium: "normal", med: "normal", mid: "normal", moderate: "normal", standard: "normal", regular: "normal", default: "normal", p2: "normal",
  high: "high", important: "high", major: "high", serious: "high", blocking: "high", blocker: "high", p1: "high",
  urgent: "urgent", critical: "urgent", emergency: "urgent", asap: "urgent", immediate: "urgent", immediately: "urgent", outage: "urgent", p0: "urgent", sev1: "urgent",
};

/**
 * Old labels were "High, blocking me" and "Urgent, server down", so anything
 * with a comma is judged by what's in front of it. Nothing recognizable lands on
 * normal: a ticket that quietly sinks to Low is worse than one that's a bit loud.
 */
export function normalizeUrgency(raw: unknown): UrgencyKey {
  const first = String(raw ?? "").split(",")[0].trim().toLowerCase();
  return SYNONYMS[first] ?? "normal";
}

/** Rewrites any stored urgency that isn't one of the four. Safe to run on every boot. */
export function migrateTicketUrgency(db: Database.Database): number {
  const stored = db.prepare("SELECT DISTINCT urgency FROM tickets").all() as { urgency: string }[];
  const update = db.prepare("UPDATE tickets SET urgency = ? WHERE urgency = ?");
  let changed = 0;
  db.transaction(() => {
    for (const { urgency } of stored) {
      if ((URGENCY_KEYS as readonly string[]).includes(urgency)) continue;
      changed += update.run(normalizeUrgency(urgency), urgency).changes;
    }
  })();
  return changed;
}
