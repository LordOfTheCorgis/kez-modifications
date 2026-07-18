import type { APIRoute } from "astro";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_FILES_DIR, PUBLIC_UPLOADS_DIR } from "../../../lib/db";
import { json, requireAdmin } from "../../../lib/admin";

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
  const denied = requireAdmin(locals);
  if (denied) return denied;

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
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return json(kind === "image" ? { url: `/uploads/${name}` } : { file: name, originalName: file.name });
};
