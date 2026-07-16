import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_PRODUCTS, SITE_URL } from "../product-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const templatePath = path.join(distDir, "index.html");

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function buildMetaBlock(product) {
    const imageUrl = product.images?.[0] ? `${SITE_URL}${product.images[0]}` : `${SITE_URL}/images/logo.png`;
    const productUrl = `${SITE_URL}/product/${product.id}`;

    return [
        `  <meta property="og:title" content="${escapeHtml(product.name)}" />`,
        `  <meta property="og:description" content="${escapeHtml(product.desc)}" />`,
        `  <meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        `  <meta property="og:type" content="website" />`,
        `  <meta property="og:url" content="${escapeHtml(productUrl)}" />`,
        `  <meta name="twitter:card" content="summary_large_image" />`,
        `  <meta name="twitter:title" content="${escapeHtml(product.name)}" />`,
        `  <meta name="twitter:description" content="${escapeHtml(product.desc)}" />`,
        `  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    ].join("\n");
}

function injectProductMeta(html, product) {
    const pattern = /<!-- Open Graph Meta Tags for Link Embedding -->[\s\S]*?<!-- End Open Graph -->/;
    const replacement = `<!-- Open Graph Meta Tags for Link Embedding -->\n${buildMetaBlock(product)}\n  <!-- End Open Graph -->`;
    return html.replace(pattern, replacement);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

const template = fs.readFileSync(templatePath, "utf-8");

for (const product of DEFAULT_PRODUCTS) {
    const productBasePath = path.join(distDir, "product");
    ensureDir(productBasePath);
    const productPath = path.join(productBasePath, product.id);
    fs.rmSync(path.join(distDir, "product", product.id), { recursive: true, force: true });
    const html = injectProductMeta(template, product);
    fs.writeFileSync(productPath, html, "utf-8");
}

console.log(`Generated ${DEFAULT_PRODUCTS.length} product pages.`);