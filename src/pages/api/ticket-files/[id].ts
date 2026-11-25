import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { db, TICKET_FILES_DIR } from "../../../lib/db";
import type { TicketAttachmentRow } from "../../../lib/db";
import { getTicket, ticketAccess } from "../../../lib/tickets";

/**
 * The only way to reach a ticket image. Same rule as the thread itself: the
 * ticket's owner, or staff with at least view on Support. Everyone else gets a
 * 404 so nobody can probe which attachment ids exist.
 */
export const GET: APIRoute = ({ params, locals }) => {
  const row = db.prepare("SELECT * FROM ticket_attachments WHERE id = ?").get(Number(params.id ?? 0)) as
    | TicketAttachmentRow
    | undefined;
  const ticket = row ? getTicket(row.ticket_id) : undefined;
  if (!row || !ticket || !ticketAccess(locals.user, ticket).view) return new Response("Not found", { status: 404 });

  const file = path.join(TICKET_FILES_DIR, path.basename(row.stored_name));
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      // type comes from the sniffed bytes we stored, and nosniff stops a browser second-guessing it
      "Content-Type": row.mime,
      "Content-Length": String(fs.statSync(file).size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
};
