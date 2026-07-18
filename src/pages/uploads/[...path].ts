import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { PUBLIC_UPLOADS_DIR } from "../../lib/db";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** Serves admin-uploaded PUBLIC images (product art). Product files never live here. */
export const GET: APIRoute = ({ params }) => {
  const rel = params.path ?? "";
  const resolved = path.resolve(PUBLIC_UPLOADS_DIR, rel);
  if (!resolved.startsWith(PUBLIC_UPLOADS_DIR + path.sep)) {
    return new Response("Bad path", { status: 400 });
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!MIME[ext] || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const stream = Readable.toWeb(fs.createReadStream(resolved)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": MIME[ext],
      "Cache-Control": "public, max-age=86400",
    },
  });
};
