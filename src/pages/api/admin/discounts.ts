import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { json, requirePerm } from "../../../lib/admin";
import { logToDiscord } from "../../../lib/notify";
import { parseDiscountInput } from "../../../lib/discounts";

export const GET: APIRoute = ({ locals }) => {
  const denied = requirePerm(locals, "discounts", 1);
  if (denied) return denied;
  return json({ discounts: db.prepare("SELECT * FROM discounts ORDER BY id DESC").all() });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requirePerm(locals, "discounts", 2);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const code = String(b?.code ?? "").trim();
  if (!code || !/^[A-Za-z0-9_-]{2,32}$/.test(code)) return json({ error: "invalid code" }, 400);
  const parsed = parseDiscountInput(b);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const { percent, maxUses, startsAt, expiresAt } = parsed;
  try {
    const info = db
      .prepare(
        "INSERT INTO discounts (code, percent, max_uses, starts_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        code,
        percent,
        maxUses,
        startsAt,
        expiresAt,
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
