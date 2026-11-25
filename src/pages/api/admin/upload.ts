import type { APIRoute } from "astro";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PRIVATE_FILES_DIR, PUBLIC_UPLOADS_DIR } from "../../../lib/db";
import { json, requirePerm } from "../../../lib/admin";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

/**
 * multipart: file + kind ('image' | 'file').
 * Images land in the public uploads dir (served via /uploads/...).
 * Product files land in the PRIVATE dir and only their filename is returned —
 * it is stored as packs.file_url and only ever read by /api/download.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requirePerm(locals, ["products", "settings"], 2);
  if (denied) return denied;

  // formData() buffers the entire body, so refuse before it starts instead of
  // finding out the file was too big after it's already eaten the RAM
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 1024 * 1024) {
    return json({ error: "file too large (500MB max)" }, 413);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind") === "file" ? "file" : "image";
  if (!(file instanceof File) || file.size === 0) return json({ error: "file required" }, 400);

  const ext = path.extname(file.name).toLowerCase();
  if (kind === "image") {
    if (!IMAGE_EXTS.has(ext)) return json({ error: "unsupported image type" }, 400);
    if (file.size > MAX_IMAGE_BYTES) return json({ error: "image too large (10MB max)" }, 400);
  } else if (file.size > MAX_FILE_BYTES) {
    return json({ error: "file too large (500MB max)" }, 400);
  }

  const name = `${crypto.randomUUID()}${ext || ".bin"}`;
  const dir = kind === "image" ? PUBLIC_UPLOADS_DIR : PRIVATE_FILES_DIR;
  // stream it out, the old arrayBuffer + Buffer.from path held two more full copies
  await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), fs.createWriteStream(path.join(dir, name)));

  return json(kind === "image" ? { url: `/uploads/${name}` } : { file: name, originalName: file.name });
};
