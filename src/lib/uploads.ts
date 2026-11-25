import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * formData() buffers the whole body, so refuse before it starts instead of
 * finding out the file was too big after it already ate the RAM. 1 MB of slack
 * covers the multipart framing and the text fields riding along.
 */
export function tooLarge(request: Request, maxBytes: number): boolean {
  return Number(request.headers.get("content-length") ?? 0) > maxBytes + 1024 * 1024;
}

/** Stream a File to disk. The old arrayBuffer + Buffer.from path held two more full copies. */
export async function streamToDisk(file: File, dest: string): Promise<void> {
  await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
}
