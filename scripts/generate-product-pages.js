import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SITE_URL } from "../site-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const templatePath = path.join(distDir, "index.html");

// Build environments (Netlify/Cloudflare) provide these via process.env;
// local builds fall back to the .env file Vite uses.
function loadEnv() {
    const env = { ...process.env };
    const envPath = path.join(rootDir, ".env");
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
            const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
            if (match && !(match[1] in env)) env[match[1]] = match[2];
        }
    }
    return env;
}

async function fetchProducts() {
    const env = loadEnv();
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_KEY;
    if (!url || !key) {
        console.warn("Supabase env vars missing; skipping product page generation.");
        return [];
    }

    const response = await fetch(`${url}/rest/v1/products?select=id,name,description,images`, {
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        throw new Error(`Supabase request failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function productImageUrl(product) {
    const first = product.images?.[0];
    if (!first) return `${SITE_URL}/images/logo.png`;
    return first.startsWith("http") ? first : `${SITE_URL}${first}`;
}

function buildMetaBlock(product) {
    const imageUrl = productImageUrl(product);
    const productUrl = `${SITE_URL}/product/${product.id}`;

    return [
        `  <meta property="og:title" content="${escapeHtml(product.name)}" />`,
        `  <meta property="og:description" content="${escapeHtml(product.description ?? "")}" />`,
        `  <meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        `  <meta property="og:type" content="website" />`,
        `  <meta property="og:url" content="${escapeHtml(productUrl)}" />`,
        `  <meta name="twitter:card" content="summary_large_image" />`,
        `  <meta name="twitter:title" content="${escapeHtml(product.name)}" />`,
        `  <meta name="twitter:description" content="${escapeHtml(product.description ?? "")}" />`,
        `  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    ].join("\n");
}

function injectProductMeta(html, product) {
    const pattern = /<!-- Open Graph Meta Tags for Link Embedding -->[\s\S]*?<!-- End Open Graph -->/;
    const replacement = `<!-- Open Graph Meta Tags for Link Embedding -->\n${buildMetaBlock(product)}\n  <!-- End Open Graph -->`;
    return html.replace(pattern, replacement);
}

async function main() {
    let products;
    try {
        products = await fetchProducts();
    } catch (error) {
        console.warn("Unable to fetch products from Supabase; skipping product page generation.");
        console.warn(String(error));
        return;
    }

    if (products.length === 0) {
        console.log("No products in Supabase; no product pages generated.");
        return;
    }

    const template = fs.readFileSync(templatePath, "utf-8");
    const productBasePath = path.join(distDir, "product");
    fs.rmSync(productBasePath, { recursive: true, force: true });
    fs.mkdirSync(productBasePath, { recursive: true });

    for (const product of products) {
        const safeId = String(product.id).replace(/[^a-zA-Z0-9_-]/g, "");
        if (!safeId) continue;
        const html = injectProductMeta(template, product);
        fs.writeFileSync(path.join(productBasePath, safeId), html, "utf-8");
    }

    console.log(`Generated ${products.length} product pages from Supabase.`);
}

main();
