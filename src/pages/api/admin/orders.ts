import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import type { PackRow } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";
import { assignRole } from "../../../lib/discord";
import { logToDiscord } from "../../../lib/notify";
import { hasPaidOrder } from "../../../lib/ownership";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const orders = db
    .prepare(
      `SELECT o.*, u.name AS user_name, u.discord_id, p.name AS pack_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN packs p ON p.id = o.pack_id
       ORDER BY o.id DESC LIMIT 500`,
    )
    .all();
  return json({ orders });
};

/**
 * Manual grant. Creates a $0 paid order so the pack shows up on the account
 * page and downloads unlock. Needed because holding the Discord role stopped
 * counting as ownership, and pre-store buyers have no order row.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as {
    discord_id?: unknown;
    pack_id?: unknown;
  } | null;
  const discordId = typeof b?.discord_id === "string" ? b.discord_id.trim() : "";
  const packId = Number(b?.pack_id ?? 0);
  if (!discordId || !packId) return json({ error: "discord_id and pack_id required" }, 400);

  const user = db.prepare("SELECT id, name FROM users WHERE discord_id = ?").get(discordId) as
    | { id: number; name: string }
    | undefined;
  // they have to have signed in at least once, otherwise there's no user row to hang it on
  if (!user) return json({ error: "No account with that Discord ID has signed in yet" }, 404);

  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(packId) as PackRow | undefined;
  if (!pack) return json({ error: "Pack not found" }, 404);
  if (hasPaidOrder(user.id, pack.id)) return json({ error: "They already own this" }, 409);

  let note = `granted by ${locals.user!.name}`;
  if (pack.discord_role_id) {
    const res = await assignRole(discordId, pack.discord_role_id);
    note += res.ok ? ", role assigned" : `, role assignment failed: ${res.note}`;
  }
  db.prepare(
    `INSERT INTO orders (user_id, pack_id, status, amount, delivery_note)
     VALUES (?, ?, 'paid', 0, ?)`,
  ).run(user.id, pack.id, note);
  db.prepare("UPDATE users SET role = 'customer' WHERE id = ? AND role = 'member'").run(user.id);
  await logToDiscord(
    `:gift: **${locals.user!.name}** granted **${pack.name}** to **${user.name}** (${discordId}) — ${note}`,
    "sales",
  );
  return json({ ok: true });
};
