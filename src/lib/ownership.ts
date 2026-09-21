import { db } from "./db";
import type { PackRow } from "./db";

export function hasPaidOrder(userId: number, packId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM orders WHERE user_id = ? AND pack_id = ? AND status = 'paid'")
    .get(userId, packId);
}

/** All-access: a paid order on any grants_all_access pack. */
export function hasAllAccess(userId: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM orders o JOIN packs p ON p.id = o.pack_id
       WHERE o.user_id = ? AND o.status = 'paid' AND p.grants_all_access = 1`,
    )
    .get(userId);
}

/**
 * Ownership = paid order, full stop. Holding the pack's Discord role used to
 * count too, which blew up the moment the owner mapped packs to his generic
 * "Customer" role: commission clients logged in and owned the whole catalog.
 * Roles are delivery, not proof of purchase.
 */
export function ownsPack(userId: number, pack: PackRow): boolean {
  if (hasPaidOrder(userId, pack.id)) return true;
  return hasAllAccess(userId);
}
