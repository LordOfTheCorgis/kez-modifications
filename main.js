import { SITE_URL } from "./site-config.js";

// ─── CONFIG ───
const DISCORD_LINK = "https://discord.gg/4YfQ335DvH";
const API_BASE = "/api";

// ─── META TAGS MANAGER ───
function productImageUrl(product) {
  const first = product.images && product.images[0];
  if (!first) return `${SITE_URL}/images/logo.png`;
  return first.startsWith("http") ? first : `${SITE_URL}${first}`;
}

function updateMetaTags(product) {
  const productUrl = `${SITE_URL}/product/${product.id}`;
  const imageUrl = productImageUrl(product);
    
    // Update OG tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    
    if (ogTitle) ogTitle.setAttribute('content', product.name);
    if (ogDesc) ogDesc.setAttribute('content', product.desc);
    if (ogImage) ogImage.setAttribute('content', imageUrl);
    if (ogUrl) ogUrl.setAttribute('content', productUrl);
    
    // Update Twitter tags
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    const twImage = document.querySelector('meta[name="twitter:image"]');
    
    if (twTitle) twTitle.setAttribute('content', product.name);
    if (twDesc) twDesc.setAttribute('content', product.desc);
    if (twImage) twImage.setAttribute('content', imageUrl);
    
    // Update page title
    document.title = `${product.name} - Kez Modifications`;
}

function resetMetaTags() {
    const defaultDesc = "Premium FiveM vehicle modifications. Ready-for-road packages and developer parts crafted with precision.";
  const logoUrl = `${SITE_URL}/images/logo.png`;
    
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    
    if (ogTitle) ogTitle.setAttribute('content', 'Kez Modifications');
    if (ogDesc) ogDesc.setAttribute('content', defaultDesc);
    if (ogImage) ogImage.setAttribute('content', logoUrl);
    if (ogUrl) ogUrl.setAttribute('content', SITE_URL);
    
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    const twImage = document.querySelector('meta[name="twitter:image"]');
    
    if (twTitle) twTitle.setAttribute('content', 'Kez Modifications');
    if (twDesc) twDesc.setAttribute('content', defaultDesc);
    if (twImage) twImage.setAttribute('content', logoUrl);
    
    document.title = 'Kez Modifications';
}

// ─── EARLY META TAG INIT (for social media scrapers) ───
// Note: For proper social sharing with different meta tags per product,
// you'll need server-side rendering or a serverless function to generate
// the correct meta tags for each product URL before the page is scraped.
// Client-side JavaScript meta tag updates won't be seen by social media bots.

const CATEGORIES = [
    { id: "all", label: "All Products" },
    { id: "ready-for-road", label: "Ready For Road" },
    { id: "dev-parts", label: "Developer Parts" },
];

// ─── DATA LAYER ───
// All data lives on the server (see server/server.js); these caches are
// filled by loadData() before every render.
let cachedProducts = [];
let cachedReviews = [];
let cachedSettings = { commission_time: "1-2 weeks", commissions_open: true };

function getAdminToken() {
    return sessionStorage.getItem("sm_admin_token");
}

async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch (e) {
            // non-JSON error body; keep the status message
        }
        throw new Error(message);
    }
    const contentType = res.headers.get("content-type") || "";
    return contentType.includes("application/json") ? res.json() : null;
}

function getProducts() {
    return cachedProducts;
}
function getReviews() {
    return cachedReviews;
}
function getCommissionTime() {
    return cachedSettings.commission_time || "1-2 weeks";
}
function getCommissionsOpen() {
    return cachedSettings.commissions_open !== false;
}

let dataLoadPromise = null;
async function loadData(force = false) {
    if (dataLoadPromise && !force) return dataLoadPromise;
    dataLoadPromise = (async () => {
        const [products, reviews, settings] = await Promise.all([
            apiFetch("/products").catch((e) => {
                console.warn("Unable to load products:", e);
                return cachedProducts;
            }),
            apiFetch("/reviews").catch((e) => {
                console.warn("Unable to load reviews:", e);
                return cachedReviews;
            }),
            apiFetch("/settings").catch((e) => {
                console.warn("Unable to load settings:", e);
                return null;
            }),
        ]);
        cachedProducts = products;
        cachedReviews = reviews;
        if (settings) cachedSettings = settings;
    })();
    return dataLoadPromise;
}

async function pushCommissionTime(value) {
    cachedSettings = await apiFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({ commission_time: value }),
    });
}

async function pushCommissionsOpen(value) {
    cachedSettings = await apiFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({ commissions_open: !!value }),
    });
}

async function pushProduct(product) {
    const saved = await apiFetch("/products", {
        method: "POST",
        body: JSON.stringify(product),
    });
    const exists = cachedProducts.some((p) => p.id === saved.id);
    cachedProducts = exists
        ? cachedProducts.map((p) => (p.id === saved.id ? saved : p))
        : [...cachedProducts, saved];
    return saved;
}

async function deleteProductRemote(id) {
    await apiFetch(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    cachedProducts = cachedProducts.filter((p) => p.id !== id);
}

// ─── ADMIN AUTH ───
function isAdmin() {
    return !!getAdminToken();
}
window.adminLogout = function () {
    sessionStorage.removeItem("sm_admin_token");
    navigate("/");
};

// ─── STATE ───
let shopCat = "all";
let detailImg = 0;
let carouselIdx = 0;
let carouselTimer = null;

let adminProductImages = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHTML(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function stopCarousel() {
    if (carouselTimer) {
        clearInterval(carouselTimer);
        carouselTimer = null;
    }
}

function stars(n) {
    return Array.from(
        { length: 5 },
        (_, i) => `<span class="star ${i < n ? "filled" : ""}">★</span>`,
    ).join("");
}

function setNav(page) {
    $$(".nav-link").forEach((l) => l.classList.remove("active"));
    const el = document.getElementById(`nav-${page}`);
    if (el) el.classList.add("active");
}

function getCatCount(id) {
    const products = getProducts();
    return id === "all"
        ? products.length
        : products.filter((p) => p.category === id).length;
}

// ─── HOME ───
function renderHome() {
    stopCarousel();
    setNav("home");
    resetMetaTags();
    const products = getProducts();
    const approvedReviews = getReviews().filter((r) => r.status === "approved");

    const carouselHTML =
        approvedReviews.length > 0
            ? `
    <section class="reviews-section">
      <div class="about-label">Reviews</div>
      <h2>What Our Customers Say</h2>
      <div class="carousel-wrap">
        <div class="carousel" id="reviews-carousel">
          ${approvedReviews
              .map(
                  (r, i) => `
            <div class="carousel-card ${i === 0 ? "active" : ""}" data-idx="${i}">
              <div class="carousel-quote">"</div>
              <div class="carousel-stars">${stars(r.rating)}</div>
              <p class="carousel-msg">${escapeHTML(r.message)}</p>
              <div class="carousel-author">— ${escapeHTML(r.name)}</div>
            </div>`,
              )
              .join("")}
        </div>
        ${
            approvedReviews.length > 1
                ? `
          <div class="carousel-controls">
            <button class="carousel-btn" onclick="carouselPrev()">‹</button>
            <div class="carousel-dots">
              ${approvedReviews
                  .map(
                      (_, i) =>
                          `<button class="dot ${i === 0 ? "active" : ""}" onclick="carouselGo(${i})"></button>`,
                  )
                  .join("")}
            </div>
            <button class="carousel-btn" onclick="carouselNext()">›</button>
          </div>`
                : ""
        }
      </div>
    </section>`
            : "";

    $("#app").innerHTML = `<div class="page">
    <section class="hero">
      <img src="/images/logo.png" class="hero-logo" alt="Kez Modifications" />
      <h1>Kez Modifications</h1>
      <p>Premium FiveM EUP Clothing, Patches, and More. Ready-for-roleplay packages crafted with care in each piece.</p>
      <div class="hero-btns">
        <a href="/shop" class="btn btn-primary">Browse Shop</a>
        <a href="/commissions" class="btn btn-ghost">Commissions</a>
        <a href="https://cfx.re/join/rma375j" target="_blank" rel="noopener" class="btn btn-accent-outline">Connect to Test Server</a>
      </div>
    </section>
    <section class="about">
      <div class="about-label">About</div>
      <h2>Who is Kez?</h2>
      <p>Kez founded Kez Modifications in April of 2026. Since then, he has focused on building a community of enthusiasts who value quality, attention to detail, and premium modifications. What started as a passion project has grown into a trusted name in the FiveM modding scene.</p>
    </section>
    <section class="featured">
      <div class="featured-header">
        <h2>Featured Products</h2>
        <a href="/shop" class="btn btn-ghost btn-sm">View All →</a>
      </div>
      <div class="featured-grid">
        ${products
            .map(
                (p) => `
          <div class="product-card" onclick="goProduct('${p.id}')">
            <div class="product-img-wrap"><img src="${p.images[0]}" alt="${p.name}" /></div>
            <div class="product-body">
              <div class="product-creator">${p.tag}</div>
              <div class="product-name">${p.name}</div>
              <div class="product-price">$${p.price}</div>
            </div>
          </div>`,
            )
            .join("")}
      </div>
    </section>
    ${carouselHTML}
    <section class="review-form-section">
      <div class="review-form-inner">
        <div class="about-label">Feedback</div>
        <h2>Leave a Review</h2>
        <p>Enjoyed our work? Let others know — reviews go live after approval.</p>
        <form class="review-form" id="review-form" onsubmit="submitReview(event)">
          <div class="form-row">
            <label>Your Name</label>
            <input type="text" id="rv-name" placeholder="e.g. John D." required maxlength="60" class="form-input" />
          </div>
          <div class="form-row">
            <label>Rating</label>
            <div class="star-picker" id="star-picker">
              ${[1, 2, 3, 4, 5]
                  .map(
                      (n) =>
                          `<span class="star-pick" data-val="${n}"
                  onclick="pickStar(${n})"
                  onmouseenter="hoverStars(${n})"
                  onmouseleave="unhoverStars()">★</span>`,
                  )
                  .join("")}
            </div>
            <input type="hidden" id="rv-rating" value="0" />
          </div>
          <div class="form-row">
            <label>Your Review</label>
            <textarea id="rv-msg" placeholder="Tell us about your experience..." required maxlength="500" rows="4" class="form-input"></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Submit Review</button>
        </form>
        <div id="review-thanks" class="review-thanks" style="display:none">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
          Thanks! Your review has been submitted and is pending approval.
        </div>
      </div>
    </section>
  </div>`;

    if (approvedReviews.length > 1) {
        carouselIdx = 0;
        carouselTimer = setInterval(() => carouselNext(), 4500);
    }
}

// ─── STAR PICKER ───
window.pickStar = function (n) {
    document.getElementById("rv-rating").value = n;
    $$("#star-picker .star-pick").forEach((s, i) =>
        s.classList.toggle("active", i < n),
    );
};
window.hoverStars = function (n) {
    $$("#star-picker .star-pick").forEach((s, i) =>
        s.classList.toggle("hover", i < n),
    );
};
window.unhoverStars = function () {
    $$("#star-picker .star-pick").forEach((s) => s.classList.remove("hover"));
};

window.submitReview = async function (e) {
    e.preventDefault();
    const name = document.getElementById("rv-name").value.trim();
    const rating = parseInt(document.getElementById("rv-rating").value);
    const message = document.getElementById("rv-msg").value.trim();
    if (!name || !message) return;
    if (rating < 1 || rating > 5) {
        alert("Please select a star rating.");
        return;
    }

    try {
        await apiFetch("/reviews", {
            method: "POST",
            body: JSON.stringify({ name, rating, message }),
        });
    } catch (err) {
        alert("Failed to submit review: " + err.message);
        return;
    }

    document.getElementById("review-form").style.display = "none";
    document.getElementById("review-thanks").style.display = "flex";
};

// ─── CAROUSEL ───
window.carouselPrev = function () {
    stopCarousel();
    const count = getReviews().filter((r) => r.status === "approved").length;
    carouselIdx = (carouselIdx - 1 + count) % count;
    updateCarousel();
    carouselTimer = setInterval(() => carouselNext(), 4500);
};
window.carouselNext = function () {
    if (!document.getElementById("reviews-carousel")) {
        stopCarousel();
        return;
    }
    const count = getReviews().filter((r) => r.status === "approved").length;
    carouselIdx = (carouselIdx + 1) % count;
    updateCarousel();
};
window.carouselGo = function (i) {
    stopCarousel();
    carouselIdx = i;
    updateCarousel();
    carouselTimer = setInterval(() => carouselNext(), 4500);
};
function updateCarousel() {
    $$(".carousel-card").forEach((c, i) =>
        c.classList.toggle("active", i === carouselIdx),
    );
    $$(".dot").forEach((d, i) =>
        d.classList.toggle("active", i === carouselIdx),
    );
}

// ─── SHOP CARD ───
function card(p) {
    return `<div class="product-card" onclick="goProduct('${p.id}')">
    <div class="product-img-wrap">
      <img src="${p.images[0]}" alt="${p.name}" />
    </div>
    <div class="product-body">
      <div class="product-creator">${p.tag}</div>
      <div class="product-name">${p.name}</div>
      <p class="product-desc">${p.desc}</p>
      <div class="product-price">$${p.price}</div>
    </div>
  </div>`;
}

// ─── SHOP ───
function renderShop(cat) {
    stopCarousel();
    if (cat !== undefined) shopCat = cat;
    setNav("shop");
    resetMetaTags();
    const products = getProducts();
    const filtered =
        shopCat === "all"
            ? products
            : products.filter((p) => p.category === shopCat);
    const label =
        CATEGORIES.find((c) => c.id === shopCat)?.label || "All Products";

    $("#app").innerHTML = `<div class="page">
    <div class="shop-layout">
      <aside class="sidebar">
        <div class="sidebar-label">Categories</div>
        ${CATEGORIES.map(
            (c) => `
          <div class="sidebar-item ${shopCat === c.id ? "active" : ""}" onclick="renderShop('${c.id}')">
            ${c.label}
            <span class="sidebar-count">${getCatCount(c.id)}</span>
          </div>`,
        ).join("")}
      </aside>
      <div class="shop-content">
        <div class="shop-header">
          <h1>${label}</h1>
          <p>${filtered.length} product${filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <div class="products-grid">${filtered.map((p) => card(p)).join("")}</div>
      </div>
    </div>
  </div>`;
}

// ─── PRODUCT DETAIL ───
function renderProduct(id) {
    stopCarousel();
    const products = getProducts();
    const p = products.find((x) => x.id === id);
    if (!p) {
        renderShop();
        return;
    }
    setNav("shop");
    detailImg = 0;
    updateMetaTags(p);

    $("#app").innerHTML = `<div class="page">
    <div class="detail-layout">
      <button class="detail-back" onclick="navigate('/shop')">← Back to Shop</button>
      <div class="detail-content">
        <div class="detail-gallery">
          <div class="detail-main-img">
            <img src="${p.images[0]}" alt="${p.name}" id="detail-img" />
            <div class="img-nav">
              <button class="img-btn" onclick="detailPrev('${p.id}')">‹</button>
              <button class="img-btn" onclick="detailNext('${p.id}')">›</button>
            </div>
          </div>
          <div class="detail-thumbs">
            ${p.images
                .map(
                    (img, i) => `
              <img src="${img}" alt="thumb ${i + 1}" class="detail-thumb ${i === 0 ? "active" : ""}" onclick="detailThumb('${p.id}',${i})" />`,
                )
                .join("")}
          </div>
        </div>
        <div class="detail-info">
          <div class="product-creator">${p.tag}</div>
          <h1 class="detail-name">${p.name}</h1>
          <div class="detail-price">$${p.price}</div>
          <p class="detail-desc">${p.desc}</p>
          ${
              p.lods
                  ? `
            <div class="detail-section">
              <div class="detail-section-title">LOD Information</div>
              <div class="lod-grid">${p.lods.map((l) => `<span class="lod-tag">${l.l}: ${l.v}</span>`).join("")}</div>
            </div>`
                  : ""
          }
          ${p.warning ? `<div class="product-warning">${p.warning}</div>` : ""}
          ${p.credits ? `<div class="detail-credits">${p.credits}</div>` : ""}
          <a href="${DISCORD_LINK}" target="_blank" rel="noopener" class="btn btn-primary btn-purchase">
            <svg width="20" height="15" viewBox="0 0 71 55" fill="none"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18 -.9 30.6.3 43a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.3 36.3 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.5 58.5 0 0070.2 43.2a.3.3 0 00.1-.2c1.4-14.5-2.4-27.1-10.1-38.2a.2.2 0 00-.1 0zM23.7 35.6c-3.3 0-6-3-6-6.8s2.7-6.8 6-6.8 6.1 3.1 6 6.8c0 3.7-2.6 6.8-6 6.8zm22.2 0c-3.3 0-6-3-6-6.8s2.6-6.8 6-6.8 6 3.1 6 6.8c0 3.7-2.6 6.8-6 6.8z" fill="currentColor"/></svg>
            Purchase In Discord
          </a>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── DETAIL IMAGE NAV ───
window.detailPrev = function (id) {
    const p = getProducts().find((x) => x.id === id);
    detailImg = (detailImg - 1 + p.images.length) % p.images.length;
    updateDetailImg(p);
};
window.detailNext = function (id) {
    const p = getProducts().find((x) => x.id === id);
    detailImg = (detailImg + 1) % p.images.length;
    updateDetailImg(p);
};
window.detailThumb = function (id, i) {
    const p = getProducts().find((x) => x.id === id);
    detailImg = i;
    updateDetailImg(p);
};
function updateDetailImg(p) {
    const img = document.getElementById("detail-img");
    if (img) img.src = p.images[detailImg];
    $$(".detail-thumb").forEach((t, i) =>
        t.classList.toggle("active", i === detailImg),
    );
}

// ─── COMMISSIONS ───
function renderCommissions() {
    stopCarousel();
    setNav("commissions");
    resetMetaTags();
    const _commissionsOpen = getCommissionsOpen();
    const _closedBanner = !_commissionsOpen
      ? `<div class="commissions-closed-banner">Commissions are currently closed.</div>`
      : "";
    $("#app").innerHTML = `<div class="page">
    <div class="commissions-page">
      <div class="commissions-header">
        <h1>Custom Commissions</h1>
        <p>Looking for a tailored, high-fidelity vehicle or specialized development work? Kez Modifications offers exclusive custom commissions. Connect with me in either of the Discord communities below to discuss your project, get a quote, and place your order.</p>
      </div>
      ${_closedBanner}
      <div class="commissions-card">
        <div class="commissions-card-title">Where to Order</div>
        <div class="discord-links">
          <a href="https://discord.gg/aka5h2FxPq" target="_blank" rel="noopener" class="btn btn-discord">
            <svg width="24" height="24" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.08 0A72.37 72.37 0 0 0 45.67 0a105.14 105.14 0 0 0-26.23 8.07C2.04 33.84-2.4 61.11.96 88.04a105.73 105.73 0 0 0 32.27 16.32 77.7 77.7 0 0 0 6.89-11.23 68.42 68.42 0 0 1-10.85-5.18c.91-.67 1.8-1.37 2.65-2.11a75.57 75.57 0 0 0 64.32 0c.86.74 1.76 1.44 2.66 2.1a68.8 68.8 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.23 105.7 105.7 0 0 0 32.28-16.32c3.78-31.59-3.21-58.46-19.5-79.97zM42.49 65.54c-5.83 0-10.63-5.32-10.63-11.83 0-6.5 4.7-11.82 10.63-11.82 5.96 0 10.69 5.34 10.63 11.82 0 6.51-4.7 11.83-10.63 11.83zm42.16 0c-5.83 0-10.63-5.32-10.63-11.83 0-6.5 4.7-11.82 10.63-11.82 5.96 0 10.69 5.34 10.63 11.82 0 6.51-4.73 11.83-10.63 11.83z"/></svg>
            Kez Modifications
          </a>
          <a href="https://discord.gg/jKtkTnMR4E" target="_blank" rel="noopener" class="btn btn-discord">
            <svg width="24" height="24" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.08 0A72.37 72.37 0 0 0 45.67 0a105.14 105.14 0 0 0-26.23 8.07C2.04 33.84-2.4 61.11.96 88.04a105.73 105.73 0 0 0 32.27 16.32 77.7 77.7 0 0 0 6.89-11.23 68.42 68.42 0 0 1-10.85-5.18c.91-.67 1.8-1.37 2.65-2.11a75.57 75.57 0 0 0 64.32 0c.86.74 1.76 1.44 2.66 2.1a68.8 68.8 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.23 105.7 105.7 0 0 0 32.28-16.32c3.78-31.59-3.21-58.46-19.5-79.97zM42.49 65.54c-5.83 0-10.63-5.32-10.63-11.83 0-6.5 4.7-11.82 10.63-11.82 5.96 0 10.69 5.34 10.63 11.82 0 6.51-4.7 11.83-10.63 11.83zm42.16 0c-5.83 0-10.63-5.32-10.63-11.83 0-6.5 4.7-11.82 10.63-11.82 5.96 0 10.69 5.34 10.63 11.82 0 6.51-4.73 11.83-10.63 11.83z"/></svg>
            Centrix Developer Hub
          </a>
        </div>
      </div>
      <div class="queue-info">
        <div class="queue-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="queue-text">
          <strong>Current Queue Status</strong>
          <span>Estimated Date to Done is currently about <strong>${getCommissionTime()}</strong> from time of order. Secure your spot now!</span>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── ADMIN: LOGIN ───
function renderAdminLogin(err) {
    stopCarousel();
    resetMetaTags();
    $$(".nav-link").forEach((l) => l.classList.remove("active"));
    $("#app").innerHTML = `<div class="page">
    <div class="admin-login-wrap">
      <div class="admin-login-box">
        <img src="/images/logo.png" alt="SM" style="height:52px;margin-bottom:1.25rem;" />
        <h2>Admin Panel</h2>
        <p class="admin-login-sub">Kez Modifications</p>
        ${err ? `<div class="admin-error">Incorrect password. Try again.</div>` : ""}
        <form onsubmit="doAdminLogin(event)" class="admin-login-form">
          <input type="password" id="admin-pass" placeholder="Password" class="form-input" autofocus />
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:0.5rem;">Sign In</button>
        </form>
        <a href="/" style="display:block;text-align:center;margin-top:1.25rem;font-size:0.8rem;color:var(--muted);" onclick="event.preventDefault(); navigate('/')">← Back to site</a>
      </div>
    </div>
  </div>`;
}

window.doAdminLogin = async function (e) {
    e.preventDefault();
    const pass = document.getElementById("admin-pass").value;
    try {
        const result = await apiFetch("/login", {
            method: "POST",
            body: JSON.stringify({ password: pass }),
        });
        sessionStorage.setItem("sm_admin_token", result.token);
        await loadData(true);
        navigate("/admin/products");
    } catch (err) {
        renderAdminLogin(true);
    }
};

// ─── ADMIN SHELL ───
function adminShell(activePage, content) {
    const pendingCount = getReviews().filter(
        (r) => r.status === "pending",
    ).length;
    return `<div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="admin-sidebar-brand">Admin Panel</div>
      <a href="/admin/products" class="admin-nav-item ${activePage === "products" ? "active" : ""}" onclick="event.preventDefault(); navigate('/admin/products')">Products</a>
      <a href="/admin/reviews" class="admin-nav-item ${activePage === "reviews" ? "active" : ""}" onclick="event.preventDefault(); navigate('/admin/reviews')">
        Reviews${pendingCount > 0 ? ` <span class="admin-badge">${pendingCount}</span>` : ""}
      </a>
      <a href="/admin/commissions" class="admin-nav-item ${activePage === "commissions" ? "active" : ""}" onclick="event.preventDefault(); navigate('/admin/commissions')">Commissions</a>
      <div class="admin-sidebar-divider"></div>
      <a href="/" class="admin-nav-item" onclick="event.preventDefault(); navigate('/')">Back to Site</a>
      <button class="admin-nav-item admin-nav-btn" onclick="adminLogout()">Logout</button>
    </aside>
    <div class="admin-content">
      ${content}
    </div>
  </div>`;
}

// ─── ADMIN: PRODUCTS ───
function renderAdminProducts() {
    if (!isAdmin()) {
        renderAdminLogin();
        return;
    }
    stopCarousel();
    resetMetaTags();
    $$(".nav-link").forEach((l) => l.classList.remove("active"));
    const products = getProducts();

    $("#app").innerHTML = `<div class="page admin-page">
    ${adminShell(
        "products",
        `
      <div class="admin-section-header">
        <h1>Products</h1>
        <button class="btn btn-primary btn-sm" onclick="showAddProduct()">+ Add Product</button>
      </div>

      <div id="add-product-form" style="display:none" class="admin-card">
        <h3 id="ap-form-title" style="margin-bottom:1.25rem;font-size:1rem;font-weight:700;">New Product</h3>
        <form onsubmit="saveProduct(event)" class="admin-form">
          <input type="hidden" id="ap-id" value="" />
          <div class="form-row">
            <label>Name</label>
            <input type="text" id="ap-name" required placeholder="e.g. LSPD Ford Explorer" class="form-input" />
          </div>
          <div class="admin-form-2col">
            <div class="form-row">
              <label>Category</label>
              <select id="ap-cat" class="form-input" onchange="syncAdminTag()">
                <option value="ready-for-road">Ready For Road</option>
                <option value="dev-parts">Developer Parts</option>
              </select>
            </div>
            <div class="form-row">
              <label>Price ($)</label>
              <input type="number" id="ap-price" min="0" step="0.01" required placeholder="10" class="form-input" />
            </div>
          </div>
          <div class="form-row">
            <label>Tag <span class="label-hint">(shown on card)</span></label>
            <input type="text" id="ap-tag" required placeholder="e.g. Ready For Road" class="form-input" />
          </div>
          <div class="form-row">
            <label>Description</label>
            <textarea id="ap-desc" required rows="3" placeholder="Short product description..." class="form-input"></textarea>
          </div>
          <div class="form-row">
            <label>Images</label>
            <input type="file" id="ap-images-upload" accept="image/*" multiple class="form-input" onchange="previewAdminImages(event)" />
            <div id="ap-images-preview" class="admin-img-preview"></div>
          </div>
          <div class="form-row">
            <label>Credits <span class="label-hint">(optional)</span></label>
            <input type="text" id="ap-credits" placeholder="e.g. Model: @Author" class="form-input" />
          </div>
          <div class="form-row">
            <label>Warning <span class="label-hint">(optional)</span></label>
            <input type="text" id="ap-warning" placeholder="e.g. ⚠ Not for production use." class="form-input" />
          </div>
          <div class="admin-form-actions">
            <button type="submit" id="ap-submit-btn" class="btn btn-primary">Save Product</button>
            <button type="button" class="btn btn-ghost" onclick="hideAddProduct()">Cancel</button>
          </div>
        </form>
      </div>

      <div class="admin-table-wrap">
        ${
            products.length === 0
                ? '<p class="admin-empty">No products yet. Add one above.</p>'
                : `<table class="admin-table">
              <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Images</th><th></th></tr></thead>
              <tbody>
                ${products
                    .map(
                        (p) => `
                  <tr>
                    <td>
                      <div class="admin-product-cell">
                        <img src="${p.images[0]}" class="admin-product-thumb" alt="" />
                        <span>${escapeHTML(p.name)}</span>
                      </div>
                    </td>
                    <td><span class="admin-tag-pill">${escapeHTML(p.tag)}</span></td>
                    <td>$${p.price}</td>
                    <td>${p.images.length}</td>
                    <td class="admin-row-actions">
                      <button class="admin-edit-btn" onclick="editProduct('${escapeHTML(p.id)}')">Edit</button>
                      <button class="admin-del-btn" onclick="deleteProduct('${escapeHTML(p.id)}')">Delete</button>
                    </td>
                  </tr>`,
                    )
                    .join("")}
              </tbody>
            </table>`
        }
      </div>
    `,
    )}
  </div>`;
}

window.showAddProduct = function () {
  adminProductImages = [];
    document.getElementById('ap-images-preview').innerHTML = '';
    document.getElementById("ap-id").value = "";
    document.getElementById("ap-form-title").textContent = "New Product";
    document.getElementById("ap-submit-btn").textContent = "Save Product";
    document.getElementById("add-product-form").querySelector("form").reset();
    syncAdminTag();
    document.getElementById("add-product-form").style.display = "block";
    document
        .getElementById("add-product-form")
        .scrollIntoView({ behavior: "smooth" });
};
window.hideAddProduct = function () {
    document.getElementById("add-product-form").style.display = "none";
};
window.syncAdminTag = function () {
    const cat = document.getElementById("ap-cat").value;
    const tags = {
        "ready-for-road": "Ready For Road",
        "dev-parts": "Developer Parts",
    };
    const tagEl = document.getElementById("ap-tag");
    if (!tagEl.value || Object.values(tags).includes(tagEl.value))
        tagEl.value = tags[cat] || "";
};

async function uploadImage(file) {
    const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${getAdminToken()}`,
            "Content-Type": file.type,
        },
        body: file,
    });
    if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch (e) {
            // non-JSON error body; keep the status message
        }
        throw new Error(message);
    }
    return (await res.json()).url;
}

window.previewAdminImages = async function (e) {
    const files = Array.from(e.target.files);
    const preview = document.getElementById("ap-images-preview");
    preview.innerHTML = "";
    adminProductImages = new Array(files.length).fill(null);

    const submitBtn = document.getElementById("ap-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading...";

    const wrappers = files.map((file) => {
        const wrap = document.createElement("div");
        wrap.className = "admin-upload-wrap";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.className = "admin-upload-thumb";
        const spinner = document.createElement("div");
        spinner.className = "admin-upload-spinner";
        wrap.appendChild(img);
        wrap.appendChild(spinner);
        preview.appendChild(wrap);
        return { wrap, spinner };
    });

    await Promise.all(
        files.map(async (file, i) => {
            try {
                adminProductImages[i] = await uploadImage(file);
                wrappers[i].spinner.remove();
            } catch (err) {
                wrappers[i].wrap.classList.add("upload-error");
                wrappers[i].spinner.textContent = "✗";
                console.error("Upload failed:", err);
            }
        }),
    );

    const isEdit = !!document.getElementById("ap-id").value;
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? "Update Product" : "Save Product";
};

window.editProduct = function (id) {
    const p = getProducts().find((x) => x.id === id);
    if (!p) return;
    document.getElementById("ap-id").value = p.id;
    document.getElementById("ap-name").value = p.name;
    document.getElementById("ap-cat").value = p.category;
    document.getElementById("ap-price").value = p.price;
    document.getElementById("ap-tag").value = p.tag;
    document.getElementById("ap-desc").value = p.desc;
    
    adminProductImages = [...p.images];

    const preview = document.getElementById('ap-images-preview');

    preview.innerHTML = p.images.map(src => `<img src="${src}" class="admin-upload-thumb" />`).join('');

    document.getElementById("ap-credits").value = p.credits || "";
    document.getElementById("ap-warning").value = p.warning || "";
    document.getElementById("ap-form-title").textContent = "Edit Product";
    document.getElementById("ap-submit-btn").textContent = "Update Product";
    document.getElementById("add-product-form").style.display = "block";
    document
        .getElementById("add-product-form")
        .scrollIntoView({ behavior: "smooth" });
};

window.saveProduct = async function (e) {
    e.preventDefault();
    const editId = document.getElementById("ap-id").value;
    const name = document.getElementById("ap-name").value.trim();
    const category = document.getElementById("ap-cat").value;
    const price = parseFloat(document.getElementById("ap-price").value);
    const tag = document.getElementById("ap-tag").value.trim();
    const desc = document.getElementById("ap-desc").value.trim();
    const images = adminProductImages.filter(Boolean);
    const credits = document.getElementById("ap-credits").value.trim();
    const warning = document.getElementById("ap-warning").value.trim();

    if (!images.length) {
        alert("Add at least one image.");
        return;
    }

    const entry = { name, category, price, tag, desc, images };
    if (credits) entry.credits = credits;
    if (warning) entry.warning = warning;

    const existing = editId
        ? getProducts().find((p) => p.id === editId) || {}
        : {};
    const saved = editId
        ? { ...existing, ...entry, id: editId }
        : { ...entry, id: "prod-" + Date.now() };

    const submitBtn = document.getElementById("ap-submit-btn");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
        await pushProduct(saved);
    } catch (err) {
        console.error("Save failed:", err);
        alert("Failed to save product:\n" + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
    }

    renderAdminProducts();
};

window.deleteProduct = async function (id) {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    try {
        await deleteProductRemote(id);
    } catch (err) {
        console.error("Delete failed:", err);
        alert("Failed to delete product:\n" + err.message);
        return;
    }
    renderAdminProducts();
};

// ─── ADMIN: REVIEWS ───
function renderAdminReviews() {
    if (!isAdmin()) {
        renderAdminLogin();
        return;
    }
    stopCarousel();
    resetMetaTags();
    $$(".nav-link").forEach((l) => l.classList.remove("active"));
    const allReviews = getReviews();
    const pending = allReviews.filter((r) => r.status === "pending");
    const approved = allReviews.filter((r) => r.status === "approved");

    const reviewCard = (r, type) => `
    <div class="review-item">
      <div class="review-item-header">
        <span class="review-item-name">${escapeHTML(r.name)}</span>
        <span class="review-item-stars">${stars(r.rating)}</span>
        <span class="review-item-date">${new Date(r.createdAt).toLocaleDateString()}</span>
        <span class="status-pill ${type === "pending" ? "status-pending" : "status-approved"}">
          ${type === "pending" ? "Pending" : "Approved"}
        </span>
      </div>
      <p class="review-item-msg">"${escapeHTML(r.message)}"</p>
      <div class="review-item-actions">
        ${
            type === "pending"
                ? `<button class="btn btn-primary btn-sm" onclick="approveReview('${r.id}')">Approve</button>`
                : ""
        }
        <button class="btn btn-ghost btn-sm" onclick="deleteReview('${r.id}')">Delete</button>
      </div>
    </div>`;

    $("#app").innerHTML = `<div class="page admin-page">
    ${adminShell(
        "reviews",
        `
      <div class="admin-section-header">
        <h1>Reviews</h1>
      </div>

      <div class="admin-review-group">
        <div class="admin-group-label">
          Pending Approval
          ${pending.length > 0 ? `<span class="admin-badge">${pending.length}</span>` : ""}
        </div>
        ${
            pending.length > 0
                ? pending.map((r) => reviewCard(r, "pending")).join("")
                : '<p class="admin-empty" style="margin:0.75rem 0 1.5rem;">No pending reviews.</p>'
        }
      </div>

      ${
          approved.length > 0
              ? `
        <div class="admin-review-group" style="margin-top:2rem;">
          <div class="admin-group-label">
            Approved
            <span class="admin-badge admin-badge-green">${approved.length}</span>
          </div>
          ${approved.map((r) => reviewCard(r, "approved")).join("")}
        </div>`
              : ""
      }
    `,
    )}
  </div>`;
}

window.approveReview = async function (id) {
    try {
        await apiFetch(`/reviews/${encodeURIComponent(id)}/approve`, {
            method: "POST",
        });
    } catch (err) {
        alert("Failed to approve review: " + err.message);
        return;
    }
    cachedReviews = cachedReviews.map((r) =>
        r.id === id ? { ...r, status: "approved" } : r,
    );
    renderAdminReviews();
};
window.deleteReview = async function (id) {
    if (!confirm("Delete this review?")) return;
    try {
        await apiFetch(`/reviews/${encodeURIComponent(id)}`, {
            method: "DELETE",
        });
    } catch (err) {
        alert("Failed to delete review: " + err.message);
        return;
    }
    cachedReviews = cachedReviews.filter((r) => r.id !== id);
    renderAdminReviews();
};

// ─── ADMIN: COMMISSIONS ───
function renderAdminCommissions() {
    if (!isAdmin()) {
        renderAdminLogin();
        return;
    }
    stopCarousel();
    resetMetaTags();
    $$(".nav-link").forEach((l) => l.classList.remove("active"));

    $("#app").innerHTML = `<div class="page admin-page">
    ${adminShell(
        "commissions",
        `
      <div class="admin-section-header">
        <h1>Commissions</h1>
      </div>
      <div class="admin-card">
        <h3 style="margin-bottom:1.25rem;font-size:1rem;font-weight:700;">Queue Status</h3>
        <form onsubmit="saveCommissionTimeSetting(event)" class="admin-form">
          <div class="form-row">
            <label>Estimated Time</label>
            <input type="text" id="commission-time-input" class="form-input" value="${escapeHTML(getCommissionTime())}" placeholder="e.g. 1-2 weeks" required />
            <small style="color:var(--muted);margin-top:0.4rem;display:block;">Shown on the commissions page as: "Estimated Date to Done is currently about <strong>[this text]</strong> from time of order."</small>
          </div>
          <div class="form-row" style="margin-top:0.5rem;">
            <label>Open for Commissions</label>
            <label style="display:flex;align-items:center;gap:0.5rem;">
              <input type="checkbox" id="commission-open-input" ${getCommissionsOpen() ? "checked" : ""} onchange="(function(el){const l=document.getElementById('commission-open-label');l.className=el.checked?'status-open':'status-closed';l.textContent=el.checked?'Open':'Closed';})(this)" />
              <span id="commission-open-label" class="${getCommissionsOpen() ? "status-open" : "status-closed"}">${getCommissionsOpen() ? "Open" : "Closed"}</span>
            </label>
            <small style="color:var(--muted);margin-top:0.4rem;display:block;">Toggle whether commissions are currently open (shows on the public commissions page).</small>
          </div>
          <div style="display:flex;gap:0.75rem;margin-top:1.25rem;">
            <button type="submit" class="btn btn-primary btn-sm" id="commission-save-btn">Save</button>
            <button type="button" class="btn btn-primary btn-sm" id="commission-open-save-btn" onclick="saveCommissionOpenSetting()">Save Open/Closed</button>
          </div>
          <div style="display:flex;gap:1rem;align-items:flex-start;margin-top:0.75rem;">
            <div id="commission-save-msg" style="font-size:0.85rem;"></div>
            <div id="commission-open-msg" style="font-size:0.85rem;"></div>
          </div>
        </form>
      </div>
    `,
    )}
  </div>`;
}

window.saveCommissionTimeSetting = async function (e) {
    e.preventDefault();
    const value = document.getElementById("commission-time-input").value.trim();
    const btn = document.getElementById("commission-save-btn");
    const msg = document.getElementById("commission-save-msg");
    if (!value) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    msg.textContent = "";
    try {
        await pushCommissionTime(value);
        msg.style.color = "var(--green, #4ade80)";
        msg.textContent = "Saved!";
    } catch (err) {
        msg.style.color = "var(--error, #f87171)";
        msg.textContent = "Failed to save: " + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = "Save";
    }
};

window.saveCommissionOpenSetting = async function () {
  const checkbox = document.getElementById("commission-open-input");
  const btn = document.getElementById("commission-open-save-btn");
  const msg = document.getElementById("commission-open-msg");
  if (!checkbox) return;
  const value = !!checkbox.checked;
  btn.disabled = true;
  btn.textContent = "Saving…";
  msg.textContent = "";
  try {
    await pushCommissionsOpen(value);
    // update label
    const lbl = document.getElementById("commission-open-label");
    if (lbl) lbl.textContent = value ? "Open" : "Closed";
      if (lbl) lbl.className = value ? 'status-open' : 'status-closed';
    msg.style.color = "var(--green, #4ade80)";
    msg.textContent = "Saved!";
  } catch (err) {
    msg.style.color = "var(--error, #f87171)";
    msg.textContent = "Failed to save: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Open/Closed";
  }
};

// ─── NAVIGATION HELPERS ───
function navigate(path) {
    window.history.pushState({}, "", path);
    router();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
  if (link.target === "_blank" || href.startsWith("http")) return;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;

  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

// ─── ROUTER ───
window.renderShop = renderShop;
window.goProduct = function (id) {
  navigate(`/product/${id}`);
};

async function router() {
    stopCarousel();
    await loadData();
    const path = window.location.pathname;

    if (path === "/admin" || path === "/admin/") {
        isAdmin() ? renderAdminProducts() : renderAdminLogin();
    } else if (path === "/admin/login") {
        renderAdminLogin();
    } else if (path === "/admin/products") {
        isAdmin() ? renderAdminProducts() : renderAdminLogin();
    } else if (path === "/admin/reviews") {
        isAdmin() ? renderAdminReviews() : renderAdminLogin();
    } else if (path === "/admin/commissions") {
        isAdmin() ? renderAdminCommissions() : renderAdminLogin();
    } else if (path.startsWith("/product/")) {
        renderProduct(path.split("/")[2]);
    } else if (path === "/shop") {
        renderShop();
    } else if (path === "/commissions") {
        renderCommissions();
    } else {
        renderHome();
    }
    window.scrollTo(0, 0);
}

window.addEventListener("popstate", router);
window.addEventListener("load", router);
