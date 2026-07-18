import crypto from "node:crypto";
import { db } from "./db";
import type { UserRow } from "./db";

export const SESSION_COOKIE = "kez_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Creates a session row and returns the raw (unhashed) token for the cookie. */
export function createSession(userId: number): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    userId,
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function resolveSession(token: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), new Date().toISOString()) as UserRow | undefined;
  return row ?? null;
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

export function destroySessionsForUser(userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function pruneExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}
