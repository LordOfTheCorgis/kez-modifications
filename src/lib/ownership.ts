import { db } from "./db";
import type { PackRow } from "./db";

/** Paid or pre-ordered. What checkout uses to stop you buying the same thing twice. */
export function hasBought(userId: number, packId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM orders WHERE user_id = ? AND pack_id = ? AND status IN ('paid', 'preorder')")
    .get(userId, packId);
}

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

/** Pre-order and coming-soon packs have nothing to hand out yet, even to all-access. */
export function isDownloadable(pack: PackRow): boolean {
  return !!pack.file_url && (pack.status === "live" || pack.status === "hidden");
}

/** What the public can see. Hidden packs only exist for admins and people who own them. */
export function canView(pack: PackRow, user: App.Locals["user"]): boolean {
  if (pack.status !== "hidden") return true;
  if (!user) return false;
  return user.isAdmin || ownsPack(user.id, pack);
}
