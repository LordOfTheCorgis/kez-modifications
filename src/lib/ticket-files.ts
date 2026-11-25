import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, TICKET_FILES_DIR } from "./db";
import type { TicketAttachmentRow } from "./db";
import { streamToDisk } from "./uploads";

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** What the request as a whole may weigh, for the early content-length refusal. */
export const MAX_TICKET_REQUEST_BYTES = MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES;

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;
type ImageKind = keyof typeof TYPES;
const EXT_OK = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Magic bytes, because a filename and a Content-Type are both just things the
 * client typed. An .html file renamed to .png sails past either of those.
 */
export async function sniffImage(file: Blob): Promise<ImageKind | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  // RIFF....WEBP, the four bytes in the middle are the chunk size
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

export interface CheckedFile {
  file: File;
  kind: ImageKind;
}

/** All-or-nothing: one bad file rejects the lot, before anything touches the disk. */
export async function checkAttachments(files: File[]): Promise<{ ok: CheckedFile[] } | { error: string }> {
  if (files.length > MAX_ATTACHMENTS) return { error: `Attach up to ${MAX_ATTACHMENTS} images per message` };
  const ok: CheckedFile[] = [];
  for (const file of files) {
    const label = file.name.slice(0, 60) || "An attachment";
    if (file.size > MAX_ATTACHMENT_BYTES) return { error: `${label} is over 5 MB` };
    if (!EXT_OK.has(path.extname(file.name).toLowerCase())) return { error: `${label} isn't a PNG, JPG or WebP image` };
    const kind = await sniffImage(file);
    if (!kind) return { error: `${label} isn't a real PNG, JPG or WebP image` };
    ok.push({ file, kind });
  }
  return { ok };
}

export interface SavedFile {
  stored: string;
  original: string;
  mime: string;
  size: number;
}

export function removeStoredFiles(names: string[]) {
  for (const name of names) {
    try {
      fs.unlinkSync(path.join(TICKET_FILES_DIR, path.basename(name)));
    } catch (err) {
      // already gone is fine, anything else just gets logged. nothing to roll back to
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[tickets] couldn't delete attachment", name, err);
    }
  }
}

/** Writes the files under random names. If one fails, the ones already written get cleaned up. */
export async function saveAttachmentFiles(checked: CheckedFile[]): Promise<SavedFile[]> {
  const saved: SavedFile[] = [];
  try {
    for (const { file, kind } of checked) {
      // extension comes from the sniffed type, never from what the client called it
      const stored = `${crypto.randomUUID()}.${kind}`;
      await streamToDisk(file, path.join(TICKET_FILES_DIR, stored));
      saved.push({ stored, original: path.basename(file.name).slice(0, 100) || `image.${kind}`, mime: TYPES[kind], size: file.size });
    }
  } catch (err) {
    removeStoredFiles(saved.map((s) => s.stored));
    throw err;
  }
  return saved;
}

/** Call inside the same transaction that inserts the message. */
export function insertAttachments(ticketId: number, messageId: number, saved: SavedFile[]) {
  const ins = db.prepare(
    "INSERT INTO ticket_attachments (ticket_id, message_id, stored_name, original_name, mime, size) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const f of saved) ins.run(ticketId, messageId, f.stored, f.original, f.mime, f.size);
}

export function attachmentsFor(messageIds: number[]): Map<number, { id: number; name: string; url: string }[]> {
  const out = new Map<number, { id: number; name: string; url: string }[]>();
  if (!messageIds.length) return out;
  const rows = db
    .prepare(
      `SELECT id, message_id, original_name FROM ticket_attachments
       WHERE message_id IN (${messageIds.map(() => "?").join(",")}) ORDER BY id`,
    )
    .all(...messageIds) as Pick<TicketAttachmentRow, "id" | "message_id" | "original_name">[];
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    list.push({ id: r.id, name: r.original_name, url: `/api/ticket-files/${r.id}` });
    out.set(r.message_id, list);
  }
  return out;
}

/**
 * Ticket forms come as multipart (with images) or plain JSON (curl, old tabs
 * open from before this shipped). Both end up as the same shape.
 */
export async function readTicketForm(request: Request): Promise<{ fields: Record<string, unknown>; files: File[] } | null> {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return null;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    // an untouched <input type=file> still submits one empty File, so size 0 means "nothing"
    const files = form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    return { fields, files };
  }
  const fields = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return fields && typeof fields === "object" ? { fields, files: [] } : null;
}
