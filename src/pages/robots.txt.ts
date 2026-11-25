import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/seo";

// Only /api and /admin are blocked. cart, account and ticket threads are kept
// OUT of search with a noindex tag instead: a robots.txt block stops Google reading
// that tag, and blocked URLs can still get listed as bare links.
// /uploads stays open on purpose, that's where the pack images Google Images wants live.
export const GET: APIRoute = () =>
  new Response(
    ["User-agent: *", "Disallow: /api/", "Disallow: /admin", "", `Sitemap: ${absoluteUrl("/sitemap.xml")}`, ""].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
