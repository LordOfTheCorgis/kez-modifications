import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { SITE_URL } from "../site-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

// All persistent data lives under KEZ_ROOT (/home/kezmodifications in
// production). Local dev without that path falls back to ./local-data.
const KEZ_ROOT =
    process.env.KEZ_ROOT ||
    (fs.existsSync("/home/kezmodifications")
        ? "/home/kezmodifications"
        : path.join(appRoot, "local-data"));

const DATA_DIR = path.join(KEZ_ROOT, "data");
const UPLOADS_DIR = path.join(KEZ_ROOT, "uploads");
const PORT = Number(process.env.PORT || 3001);

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_JSON_BODY = 1 * 1024 * 1024;
const MAX_UPLOAD_BODY = 15 * 1024 * 1024;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const IMAGE_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
};
const CONTENT_TYPE_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
};

const CATEGORIES = ["ready-for-road", "dev-parts"];

// ─── ENV ───
function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
        const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
        if (match) env[match[1]] = match[2];
    }
    return env;
}

const fileEnv = {
    ...readEnvFile(path.join(appRoot, ".env")),
    ...readEnvFile(path.join(KEZ_ROOT, ".env")),
};
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || fileEnv.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error(
        "ADMIN_PASSWORD is not set. Provide it via environment or a .env file in the app or KEZ_ROOT directory.",
    );
    process.exit(1);
}

// ─── JSON STORE ───
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function dataPath(name) {
    return path.join(DATA_DIR, name);
}

function readStore(name, fallback) {
    try {
        return JSON.parse(fs.readFileSync(dataPath(name), "utf-8"));
    } catch (e) {
        return fallback;
    }
}

function writeStore(name, value) {
    const target = dataPath(name);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tmp, target);
}

const getProducts = () => readStore("products.json", []);
const getReviews = () => readStore("reviews.json", []);
const getSettings = () =>
    readStore("settings.json", { commission_time: "1-2 weeks", commissions_open: true });

// ─── AUTH ───
const activeTokens = new Map();
const loginAttempts = new Map();

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    return req.socket.remoteAddress || "unknown";
}

function isLoginRateLimited(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) return false;
    return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
        loginAttempts.set(ip, { ...entry, count: entry.count + 1 });
    }
}

function issueToken() {
    const token = crypto.randomBytes(32).toString("hex");
    activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
    return token;
}

function isAuthorized(req) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return false;
    const expiry = activeTokens.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
        activeTokens.delete(token);
        return false;
    }
    return true;
}

// ─── HTTP HELPERS ───
function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
}

function sendError(res, status, message) {
    sendJson(res, status, { error: message });
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error("Body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    const raw = await readBody(req, MAX_JSON_BODY);
    try {
        return JSON.parse(raw.toString("utf-8"));
    } catch (e) {
        throw new Error("Invalid JSON body");
    }
}

// ─── VALIDATION ───
function cleanString(value, maxLength) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    return trimmed;
}

function validImageRef(value) {
    return (
        typeof value === "string" &&
        (value.startsWith("/uploads/") || value.startsWith("/images/") || value.startsWith("http"))
    );
}

function sanitizeProduct(body) {
    const name = cleanString(body.name, 120);
    const tag = cleanString(body.tag, 60);
    const desc = cleanString(body.desc, 2000);
    const price = Number(body.price);
    const images = Array.isArray(body.images) ? body.images.filter(validImageRef).slice(0, 20) : [];

    if (!name || !tag || !desc) return null;
    if (!CATEGORIES.includes(body.category)) return null;
    if (!Number.isFinite(price) || price < 0) return null;
    if (images.length === 0) return null;

    const idRaw = typeof body.id === "string" ? body.id : "";
    const id = idRaw.replace(/[^a-zA-Z0-9_-]/g, "") || `prod-${Date.now()}`;

    const product = { id, name, category: body.category, price, tag, desc, images };
    const credits = cleanString(body.credits || "", 300);
    const warning = cleanString(body.warning || "", 300);
    if (credits) product.credits = credits;
    if (warning) product.warning = warning;
    if (Array.isArray(body.lods)) {
        const lods = body.lods
            .filter((l) => l && typeof l.l === "string" && typeof l.v === "string")
            .map((l) => ({ l: l.l.slice(0, 20), v: l.v.slice(0, 20) }))
            .slice(0, 10);
        if (lods.length > 0) product.lods = lods;
    }
    return product;
}

function sanitizeReview(body) {
    const name = cleanString(body.name, 60);
    const message = cleanString(body.message, 500);
    const rating = Number(body.rating);
    if (!name || !message) return null;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
    return {
        id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        name,
        rating,
        message,
        status: "pending",
        createdAt: new Date().toISOString(),
    };
}

// ─── OG META INJECTION (/product/:id) ───
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function productImageUrl(product) {
    const first = product.images && product.images[0];
    if (!first) return `${SITE_URL}/images/logo.png`;
    return first.startsWith("http") ? first : `${SITE_URL}${first}`;
}

function buildMetaBlock(product) {
    const imageUrl = productImageUrl(product);
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

function loadIndexTemplate() {
    const candidates = [
        path.join(KEZ_ROOT, "dist", "index.html"),
        path.join(appRoot, "dist", "index.html"),
        path.join(appRoot, "index.html"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
    }
    return null;
}

function serveProductPage(res, id) {
    const template = loadIndexTemplate();
    if (!template) {
        sendError(res, 500, "index.html template not found");
        return;
    }
    const product = getProducts().find((p) => p.id === id);
    let html = template;
    if (product) {
        html = template.replace(
            /<!-- Open Graph Meta Tags for Link Embedding -->[\s\S]*?<!-- End Open Graph -->/,
            `<!-- Open Graph Meta Tags for Link Embedding -->\n${buildMetaBlock(product)}\n  <!-- End Open Graph -->`,
        );
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
}

// ─── UPLOADS ───
async function handleUpload(req, res) {
    const ext = IMAGE_EXT_BY_TYPE[req.headers["content-type"]];
    if (!ext) {
        sendError(res, 415, "Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
        return;
    }
    let body;
    try {
        body = await readBody(req, MAX_UPLOAD_BODY);
    } catch (e) {
        sendError(res, 413, "Image too large (15 MB max).");
        return;
    }
    if (body.length === 0) {
        sendError(res, 400, "Empty upload.");
        return;
    }
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), body);
    sendJson(res, 201, { url: `/uploads/${filename}` });
}

function serveUpload(res, requestedName) {
    const filename = path.basename(requestedName);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
        sendError(res, 404, "Not found");
        return;
    }
    const contentType = CONTENT_TYPE_BY_EXT[path.extname(filename).toLowerCase()];
    res.writeHead(200, {
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
    });
    fs.createReadStream(filePath).pipe(res);
}

// ─── ROUTES ───
async function handleLogin(req, res) {
    const ip = clientIp(req);
    if (isLoginRateLimited(ip)) {
        sendError(res, 429, "Too many attempts. Try again later.");
        return;
    }
    const body = await readJsonBody(req);
    if (!safeEqual(body.password || "", ADMIN_PASSWORD)) {
        recordLoginFailure(ip);
        sendError(res, 401, "Incorrect password");
        return;
    }
    sendJson(res, 200, { token: issueToken() });
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;
    const method = req.method;

    if (method === "POST" && pathname === "/api/login") return handleLogin(req, res);

    if (pathname === "/api/products" && method === "GET") {
        return sendJson(res, 200, getProducts());
    }

    if (pathname === "/api/products" && method === "POST") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        const product = sanitizeProduct(await readJsonBody(req));
        if (!product) return sendError(res, 400, "Invalid product data");
        const products = getProducts();
        const exists = products.some((p) => p.id === product.id);
        const next = exists
            ? products.map((p) => (p.id === product.id ? product : p))
            : [...products, product];
        writeStore("products.json", next);
        return sendJson(res, exists ? 200 : 201, product);
    }

    const productMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9_-]+)$/);
    if (productMatch && method === "DELETE") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        writeStore("products.json", getProducts().filter((p) => p.id !== productMatch[1]));
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/reviews" && method === "GET") {
        const reviews = getReviews();
        return sendJson(
            res,
            200,
            isAuthorized(req) ? reviews : reviews.filter((r) => r.status === "approved"),
        );
    }

    if (pathname === "/api/reviews" && method === "POST") {
        const review = sanitizeReview(await readJsonBody(req));
        if (!review) return sendError(res, 400, "Invalid review data");
        writeStore("reviews.json", [...getReviews(), review]);
        return sendJson(res, 201, review);
    }

    const approveMatch = pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)\/approve$/);
    if (approveMatch && method === "POST") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        const next = getReviews().map((r) =>
            r.id === approveMatch[1] ? { ...r, status: "approved" } : r,
        );
        writeStore("reviews.json", next);
        return sendJson(res, 200, { ok: true });
    }

    const reviewMatch = pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)$/);
    if (reviewMatch && method === "DELETE") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        writeStore("reviews.json", getReviews().filter((r) => r.id !== reviewMatch[1]));
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/settings" && method === "GET") {
        return sendJson(res, 200, getSettings());
    }

    if (pathname === "/api/settings" && method === "PUT") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        const body = await readJsonBody(req);
        const current = getSettings();
        const next = { ...current };
        if (typeof body.commission_time === "string") {
            const value = cleanString(body.commission_time, 100);
            if (!value) return sendError(res, 400, "Invalid commission_time");
            next.commission_time = value;
        }
        if (typeof body.commissions_open === "boolean") {
            next.commissions_open = body.commissions_open;
        }
        writeStore("settings.json", next);
        return sendJson(res, 200, next);
    }

    if (pathname === "/api/upload" && method === "POST") {
        if (!isAuthorized(req)) return sendError(res, 401, "Unauthorized");
        return handleUpload(req, res);
    }

    if (pathname.startsWith("/uploads/") && method === "GET") {
        return serveUpload(res, pathname.slice("/uploads/".length));
    }

    const pageMatch = pathname.match(/^\/product\/([a-zA-Z0-9_-]+)\/?$/);
    if (pageMatch && method === "GET") {
        return serveProductPage(res, pageMatch[1]);
    }

    sendError(res, 404, "Not found");
}

http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
        console.error(`${req.method} ${req.url} failed:`, error.message);
        if (!res.headersSent) sendError(res, 500, error.message);
    });
}).listen(PORT, () => {
    console.log(`Kez Modifications API listening on http://127.0.0.1:${PORT}`);
    console.log(`Data root: ${KEZ_ROOT}`);
});
