import { getSiteUrl } from "./settings";

/** Absolute URL on the canonical origin. Never built from the request host, that can be an internal proxy name. */
export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${getSiteUrl()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/**
 * For <script type="application/ld+json" set:html>. JSON.stringify leaves "<" alone,
 * so a pack called "</script><script>..." would break out of the tag. Escaping it
 * keeps the JSON identical to a parser and inert to the HTML tokenizer.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Plain text cut at a word boundary, for meta descriptions. Google shows about 155 characters. */
export function clip(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).replace(/[\s,.;:-]+$/, "")}…`;
}

/**
 * Search Console offers the token three ways: the full <meta> tag, the DNS TXT
 * string ("google-site-verification=..."), or just the token. People paste whichever
 * they copied, so accept all of them and store only the bare token. "" clears it,
 * null means it wasn't any of those.
 */
export function verificationToken(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const token = v.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ?? v.replace(/^google-site-verification\s*=\s*/i, "");
  return /^[A-Za-z0-9_-]{20,100}$/.test(token.trim()) ? token.trim() : null;
}
