import { db } from "./db";
import type { StaffRoleRow, UserRow } from "./db";

/**
 * One entry per admin sidebar section. "staff" isn't here on purpose: managing
 * who gets access is owner-only and never grantable, otherwise anyone with
 * edit on it could just hand themselves everything.
 */
export const SECTIONS = {
  products: "Products & categories",
  orders: "Orders",
  discounts: "Discounts",
  commissions: "Commissions",
  reviews: "Reviews",
  users: "Users",
  settings: "Settings",
} as const;
export type Section = keyof typeof SECTIONS;
export const SECTION_KEYS = Object.keys(SECTIONS) as Section[];

// 0 none, 1 view, 2 edit. numbers so "at least view" is just >=
export type Level = 0 | 1 | 2;
export type Perms = Record<Section, Level>;

const NONE = (): Perms => Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])) as Perms;
const FULL = (): Perms => Object.fromEntries(SECTION_KEYS.map((k) => [k, 2])) as Perms;

/** Whatever junk is in the JSON column, only valid section->level pairs survive. */
export function parsePerms(raw: unknown): Partial<Perms> {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  const out: Partial<Perms> = {};
  for (const k of SECTION_KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (v === 0 || v === 1 || v === 2) out[k] = v;
  }
  return out;
}

export function isOwnerUser(user: Pick<UserRow, "discord_id" | "role">): boolean {
  const ids = (process.env.ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(user.discord_id) || user.role === "owner";
}

/** Role perms, then the person's overrides on top (an override of 0 does take access away). */
export function effectivePerms(user: UserRow): Perms {
  if (user.is_admin === 1 || isOwnerUser(user)) return FULL();
  const perms = NONE();
  if (user.staff_role_id) {
    const role = db.prepare("SELECT * FROM staff_roles WHERE id = ?").get(user.staff_role_id) as
      | StaffRoleRow
      | undefined;
    if (role) Object.assign(perms, parsePerms(role.perms));
  }
  Object.assign(perms, parsePerms(user.perm_overrides));
  return perms;
}

export function can(user: App.Locals["user"], section: Section, level: Level = 1): boolean {
  return !!user && user.perms[section] >= level;
}
