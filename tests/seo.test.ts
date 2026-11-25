import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kez-seo-"));
process.env.PUBLIC_SITE_URL = "https://kezmodifications.com/";
const { db } = await import("../src/lib/db");
const { absoluteUrl, clip, jsonLd, verificationToken } = await import("../src/lib/seo");
const { GET: sitemap } = await import("../src/pages/sitemap.xml");
const { GET: robots } = await import("../src/pages/robots.txt");

test("absoluteUrl uses the configured domain, not the request", () => {
  assert.equal(absoluteUrl("/shop"), "https://kezmodifications.com/shop");
  assert.equal(absoluteUrl("shop"), "https://kezmodifications.com/shop");
  assert.equal(absoluteUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
});

test("jsonLd can't be broken out of its script tag", () => {
  const out = jsonLd({ name: "</script><script>alert(1)</script>" });
  assert.ok(!out.includes("</script>") && !out.includes("<"));
  assert.equal(JSON.parse(out).name, "</script><script>alert(1)</script>");
});

test("clip cuts at a word and stays under the limit", () => {
  assert.equal(clip("short text"), "short text");
  const long = "word ".repeat(80);
  const out = clip(long, 155);
  assert.ok(out.length <= 155 && out.endsWith("…") && !out.includes("wor…"));
  assert.equal(clip("a\n\n  b\t c"), "a b c");
});

test("verification token accepts the tag, the DNS string and the bare code", () => {
  const code = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
  assert.equal(verificationToken(`<meta name="google-site-verification" content="${code}" />`), code);
  assert.equal(verificationToken(`google-site-verification=${code}`), code);
  assert.equal(verificationToken(`  ${code} `), code);
  assert.equal(verificationToken(""), "");
  assert.equal(verificationToken("<script>alert(1)</script>"), null);
  assert.equal(verificationToken(`"><script>${code}`), null);
  assert.equal(verificationToken("tooshort"), null);
});

test("sitemap lists public pages and packs, never hidden ones", async () => {
  const ins = db.prepare("INSERT INTO packs (name, status) VALUES (?, ?)");
  ins.run("Live", "live");
  ins.run("Secret", "hidden");
  ins.run("Soon", "coming_soon");
  ins.run("Pre", "preorder");
  db.prepare("INSERT INTO pack_versions (pack_id, version, released_on) VALUES (1, '1.0', '2026-10-01'), (1, '1.1', '2026-11-02')").run();

  const res = await sitemap({} as never);
  assert.match(res.headers.get("content-type") ?? "", /xml/);
  const xml = await res.text();
  assert.ok(xml.includes("<loc>https://kezmodifications.com/</loc>"));
  assert.ok(xml.includes("<loc>https://kezmodifications.com/shop</loc>"));
  assert.ok(xml.includes("<loc>https://kezmodifications.com/product/1</loc><lastmod>2026-11-02</lastmod>"));
  assert.ok(xml.includes("/product/3") && xml.includes("/product/4"), "coming soon and pre-order are public pages");
  assert.ok(!xml.includes("/product/2"), "hidden pack stays out");
  assert.ok(!xml.includes("/admin") && !xml.includes("/cart") && !xml.includes("/account"));
  assert.ok(!xml.includes("<lastmod></lastmod>"));
});

test("robots.txt blocks api and admin, points at the sitemap, leaves uploads open", async () => {
  const txt = await (await robots({} as never)).text();
  assert.ok(txt.includes("Disallow: /api/") && txt.includes("Disallow: /admin"));
  assert.ok(txt.includes("Sitemap: https://kezmodifications.com/sitemap.xml"));
  assert.ok(!txt.includes("/uploads") && !txt.includes("Disallow: /cart") && !txt.includes("Disallow: /account"));
});
