// shared by the server checks and the forms. no node imports in here, the
// browser bundles this file too
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp";

/** Friendly pre-flight for the file input. The server re-checks everything, this only saves a round trip. */
export function attachmentProblem(files: File[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `Attach up to ${MAX_ATTACHMENTS} images per message`;
  for (const f of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(f.name)) return `${f.name} isn't a PNG, JPG or WebP image`;
    if (f.size > MAX_ATTACHMENT_BYTES) return `${f.name} is over 5 MB`;
  }
  return null;
}
