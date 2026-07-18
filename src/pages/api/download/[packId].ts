import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { db, PRIVATE_FILES_DIR } from "../../../lib/db";
import type { PackRow } from "../../../lib/db";
import { ownsPack } from "../../../lib/ownership";

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return new Response("Sign in first", { status: 401 });

  const pack = db
    .prepare("SELECT * FROM packs WHERE id = ?")
    .get(Number(params.packId ?? 0)) as PackRow | undefined;
  if (!pack || !pack.file_url) return new Response("Not found", { status: 404 });

  if (!ownsPack(user.id, user.discordRoles, pack)) {
    return new Response("You do not own this pack", { status: 403 });
  }

  // file_url is a server-only filename inside the private dir; basename()
  // blocks traversal even if the stored value is ever tampered with.
  const filePath = path.join(PRIVATE_FILES_DIR, path.basename(pack.file_url));
  if (!fs.existsSync(filePath)) return new Response("File missing", { status: 404 });

  db.prepare("INSERT INTO download_logs (user_id, pack_id) VALUES (?, ?)").run(user.id, pack.id);

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath);
  const safeName = pack.name.replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "pack";
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeName}${ext}"`,
      "Cache-Control": "no-store",
    },
  });
};
