import { db } from "./db";
import type { PackRow } from "./db";

export function hasPaidOrder(userId: number, packId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM orders WHERE user_id = ? AND pack_id = ? AND status = 'paid'")
    .get(userId, packId);
}

/** All-access: ownership of any grants_all_access pack. */
export function hasAllAccess(userId: number, discordRoles: string[]): boolean {
  const allAccessPacks = db
    .prepare("SELECT id, discord_role_id FROM packs WHERE grants_all_access = 1")
    .all() as Pick<PackRow, "id" | "discord_role_id">[];
  return allAccessPacks.some(
    (p) =>
      (p.discord_role_id && discordRoles.includes(p.discord_role_id)) ||
      hasPaidOrder(userId, p.id),
  );
}

/** Ownership = paid order OR currently-held Discord role OR active all-access. */
export function ownsPack(userId: number, discordRoles: string[], pack: PackRow): boolean {
  if (pack.discord_role_id && discordRoles.includes(pack.discord_role_id)) return true;
  if (hasPaidOrder(userId, pack.id)) return true;
  return hasAllAccess(userId, discordRoles);
}
