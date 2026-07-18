import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";
import { logToDiscord } from "../../../lib/notify";

export const GET: APIRoute = ({ locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  return json({ discounts: db.prepare("SELECT * FROM discounts ORDER BY id DESC").all() });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireAdmin(locals);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const code = String(b?.code ?? "").trim();
  const percent = Math.round(Number(b?.percent ?? 0));
  if (!code || !/^[A-Za-z0-9_-]{2,32}$/.test(code)) return json({ error: "invalid code" }, 400);
  if (!(percent >= 1 && percent <= 100)) return json({ error: "percent must be 1-100" }, 400);
  try {
    const info = db
      .prepare(
        "INSERT INTO discounts (code, percent, max_uses, starts_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        code,
        percent,
        b?.max_uses ? Number(b.max_uses) : null,
        typeof b?.starts_at === "string" && b.starts_at ? new Date(b.starts_at).toISOString() : null,
        typeof b?.expires_at === "string" && b.expires_at ? new Date(b.expires_at).toISOString() : null,
        b?.is_active === false ? 0 : 1,
      );
    if (b?.is_active !== false) {
      await logToDiscord(`:label: Discount code \`${code}\` is live — ${percent}% off`, "discounts");
    }
    return json({ id: Number(info.lastInsertRowid) });
  } catch {
    return json({ error: "code already exists" }, 409);
  }
};
