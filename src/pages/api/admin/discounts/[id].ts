import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";
import type { DiscountRow } from "../../../../lib/db";
import { json, requireAdmin } from "../../../../lib/admin";
import { logToDiscord } from "../../../../lib/notify";

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const row = db
    .prepare("SELECT * FROM discounts WHERE id = ?")
    .get(Number(params.id ?? 0)) as DiscountRow | undefined;
  if (!row) return json({ error: "Not found" }, 404);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const isActive = b?.is_active === false ? 0 : 1;
  db.prepare(
    "UPDATE discounts SET percent = ?, max_uses = ?, starts_at = ?, expires_at = ?, is_active = ? WHERE id = ?",
  ).run(
    b?.percent ? Math.round(Number(b.percent)) : row.percent,
    b?.max_uses ? Number(b.max_uses) : null,
    typeof b?.starts_at === "string" && b.starts_at ? new Date(b.starts_at).toISOString() : null,
    typeof b?.expires_at === "string" && b.expires_at ? new Date(b.expires_at).toISOString() : null,
    isActive,
    row.id,
  );
  if (!row.is_active && isActive) {
    await logToDiscord(`:label: Discount code \`${row.code}\` is live — ${row.percent}% off`, "discounts");
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = ({ params, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const info = db.prepare("DELETE FROM discounts WHERE id = ?").run(Number(params.id ?? 0));
  return info.changes ? json({ ok: true }) : json({ error: "Not found" }, 404);
};
