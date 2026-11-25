import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// same deal as core.test.ts: db.ts opens the database on import, so DATA_DIR first
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kez-tickets-"));
const { db, TICKET_FILES_DIR } = await import("../src/lib/db");
const { normalizeUrgency, migrateTicketUrgency, URGENCY_KEYS } = await import("../src/lib/urgency");
const { sniffImage, checkAttachments, saveAttachmentFiles, insertAttachments } = await import("../src/lib/ticket-files");
const { tooLarge } = await import("../src/lib/uploads");
const { DELETE } = await import("../src/pages/api/admin/tickets/[id]");
const { GET: serveFile } = await import("../src/pages/api/ticket-files/[id]");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const bytes = (...b: number[]) => new Uint8Array(b);
const file = (name: string, data: Uint8Array | string, size?: number) => {
  const f = new File([data], name);
  // File.size is read-only, so for the oversize case pad real bytes instead
  return size && size > f.size ? new File([data, new Uint8Array(size - f.size)], name) : f;
};
const okPng = () => file("shot.png", bytes(...PNG));

test("urgency words map to the closest of the four", () => {
  const cases: Record<string, string> = {
    low: "low", "Low, whenever": "low", minor: "low", whenever: "low",
    normal: "normal", Normal: "normal", MEDIUM: "normal", standard: "normal", "": "normal", constructor: "normal", garbage: "normal",
    high: "high", "High, blocking me": "high", important: "high", " Blocker ": "high",
    urgent: "urgent", "Urgent, server down": "urgent", critical: "urgent", ASAP: "urgent",
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeUrgency(input), want, `"${input}"`);
  assert.equal(normalizeUrgency(null), "normal");
});

test("urgency migration rewrites strays, keeps every row, and is idempotent", () => {
  db.prepare("INSERT INTO users (discord_id, name) VALUES ('d1', 'cust'), ('d2', 'staff')").run();
  const ins = db.prepare("INSERT INTO tickets (user_id, subject, category, urgency) VALUES (1, ?, 'other', ?)");
  const stored = ["low", "normal", "High, blocking me", "Urgent, server down", "Low, whenever", "critical", "weird", ""];
  stored.forEach((u, i) => ins.run(`t${i}`, u));
  const before = (db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number }).n;

  assert.equal(migrateTicketUrgency(db), 6); // the two already-valid ones stay put
  const rows = db.prepare("SELECT subject, urgency FROM tickets ORDER BY id").all() as { subject: string; urgency: string }[];
  assert.deepEqual(
    rows.map((r) => r.urgency),
    ["low", "normal", "high", "urgent", "low", "urgent", "normal", "normal"],
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number }).n, before);
  assert.ok(rows.every((r) => (URGENCY_KEYS as readonly string[]).includes(r.urgency)));
  assert.equal(migrateTicketUrgency(db), 0); // second boot changes nothing
  db.prepare("DELETE FROM tickets").run();
});

test("sniffImage goes by magic bytes, not by the name", async () => {
  assert.equal(await sniffImage(new Blob([bytes(...PNG)])), "png");
  assert.equal(await sniffImage(new Blob([bytes(0xff, 0xd8, 0xff, 0xe0)])), "jpg");
  assert.equal(await sniffImage(new Blob([bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)])), "webp");
  assert.equal(await sniffImage(new Blob(["<html><script>alert(1)</script>"])), null);
  assert.equal(await sniffImage(new Blob(["GIF89a"])), null);
  // RIFF but not WEBP, a wav file for example
  assert.equal(await sniffImage(new Blob([bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)])), null);
});

test("attachment checks: type, size and count limits", async () => {
  assert.ok("ok" in (await checkAttachments([okPng(), file("a.jpg", bytes(0xff, 0xd8, 0xff)), file("b.webp", bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))])));
  assert.ok("error" in (await checkAttachments([okPng(), okPng(), okPng(), okPng()])), "4 is one too many");
  assert.ok("error" in (await checkAttachments([file("evil.png", "<html>")])), "html renamed to png");
  assert.ok("error" in (await checkAttachments([file("anim.gif", "GIF89a")])), "wrong extension");
  assert.ok("error" in (await checkAttachments([file("real.png", bytes(...PNG), 5 * 1024 * 1024 + 1)])), "just over 5 MB");
  assert.ok("ok" in (await checkAttachments([file("edge.png", bytes(...PNG), 5 * 1024 * 1024)])), "exactly 5 MB is fine");
  assert.ok("ok" in (await checkAttachments([])), "no files is fine");
});

test("oversize requests are refused from the header alone", () => {
  const req = (len: string) => new Request("http://x", { method: "POST", headers: { "content-length": len } });
  assert.equal(tooLarge(req("1000"), 15 * 1024 * 1024), false);
  assert.equal(tooLarge(req(String(17 * 1024 * 1024)), 15 * 1024 * 1024), true);
  assert.equal(tooLarge(new Request("http://x", { method: "POST" }), 100), false);
});

// one ticket owned by user 1 with a real file on disk, rebuilt for each test that needs it
async function makeTicket() {
  const t = db.prepare("INSERT INTO tickets (user_id, subject, category, urgency) VALUES (1, 'subject', 'other', 'normal')").run();
  const m = db.prepare("INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body) VALUES (?, 1, 0, 'hi')").run(t.lastInsertRowid);
  const checked = await checkAttachments([okPng()]);
  assert.ok("ok" in checked);
  const saved = await saveAttachmentFiles(checked.ok);
  insertAttachments(Number(t.lastInsertRowid), Number(m.lastInsertRowid), saved);
  return { ticketId: Number(t.lastInsertRowid), stored: saved[0].stored, attId: (db.prepare("SELECT id FROM ticket_attachments WHERE stored_name = ?").get(saved[0].stored) as { id: number }).id };
}
const user = (id: number, support: 0 | 1 | 2) => ({ id, perms: { support } }) as never;

test("stored files get a random name with the sniffed extension, never the client's", async () => {
  const { stored } = await makeTicket();
  assert.match(stored, /^[0-9a-f-]{36}\.png$/);
  assert.ok(fs.existsSync(path.join(TICKET_FILES_DIR, stored)));
  db.prepare("DELETE FROM tickets").run();
});

test("only the owner or staff with support access can fetch an attachment", async () => {
  const { attId } = await makeTicket();
  const get = async (u: unknown) => (await serveFile({ params: { id: String(attId) }, locals: { user: u } } as never)).status;
  assert.equal(await get(user(1, 0)), 200, "owner");
  assert.equal(await get(null), 404, "signed out");
  assert.equal(await get(user(2, 0)), 404, "someone else's");
  assert.equal(await get(user(2, 1)), 200, "staff with view");
  const res = await serveFile({ params: { id: String(attId) }, locals: { user: user(1, 0) } } as never);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  await res.body?.cancel();
  db.prepare("DELETE FROM tickets").run();
});

test("deleting a ticket needs support edit, and takes the messages and image files with it", async () => {
  const { ticketId, stored } = await makeTicket();
  const del = async (u: unknown) => (await DELETE({ params: { id: String(ticketId) }, locals: { user: u } } as never)).status;

  assert.equal(await del(null), 401);
  assert.equal(await del(user(1, 0)), 403, "the customer who owns it");
  assert.equal(await del(user(2, 1)), 403, "staff with view only");
  assert.ok(db.prepare("SELECT 1 FROM tickets WHERE id = ?").get(ticketId), "still there after all the refusals");
  assert.ok(fs.existsSync(path.join(TICKET_FILES_DIR, stored)));

  assert.equal(await del({ id: 2, name: "staff", perms: { support: 2 } }), 200);
  assert.equal(db.prepare("SELECT 1 FROM tickets WHERE id = ?").get(ticketId), undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ?").get(ticketId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?").get(ticketId) as { n: number }).n, 0);
  assert.equal(fs.existsSync(path.join(TICKET_FILES_DIR, stored)), false, "file is gone from disk");
  assert.equal(await del({ id: 2, name: "staff", perms: { support: 2 } }), 404, "second delete");
});
