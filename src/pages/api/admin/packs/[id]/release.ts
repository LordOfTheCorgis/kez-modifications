import type { APIRoute } from "astro";
import { db } from "../../../../../lib/db";
import type { PackRow } from "../../../../../lib/db";
import { json, requirePerm } from "../../../../../lib/admin";
import { releasePreorders } from "../../../../../lib/fulfillment";

/** Release button on the products table. Flips the pack live and delivers every waiting pre-order. */
export const POST: APIRoute = async ({ params, locals }) => {
  const denied = requirePerm(locals, "products", 2);
  if (denied) return denied;
  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(Number(params.id ?? 0)) as PackRow | undefined;
  if (!pack) return json({ error: "Not found" }, 404);
  return json(await releasePreorders(pack.id));
};
