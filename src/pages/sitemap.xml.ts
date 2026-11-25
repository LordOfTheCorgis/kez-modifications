import type { APIRoute } from "astro";
import { db } from "../lib/db";
import { absoluteUrl } from "../lib/seo";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Built per request from the database, so a pack Kez publishes is in the sitemap
 * the same minute. Hidden packs are 404 to the public and stay out. Coming soon
 * and pre-order pages are real, linkable pages, so they go in.
 */
export const GET: APIRoute = () => {
  const packs = db
    .prepare(
      `SELECT p.id, (SELECT MAX(v.released_on) FROM pack_versions v WHERE v.pack_id = p.id) AS updated
       FROM packs p WHERE p.status != 'hidden' ORDER BY p.sort_order, p.id`,
    )
    .all() as { id: number; updated: string | null }[];

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: "/" },
    { loc: "/shop" },
    { loc: "/commissions" },
    { loc: "/support" },
    { loc: "/terms" },
    // lastmod only where we really know it. Google drops sitemaps whose dates it learns to distrust
    ...packs.map((p) => ({ loc: `/product/${p.id}`, lastmod: p.updated ?? undefined })),
  ];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(absoluteUrl(u.loc))}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};
