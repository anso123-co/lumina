import { supabase } from "./supabaseClient.js";

const fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** UI helpers */
const $ = (id) => document.getElementById(id);

function toast(message, type = "success", ms = 2600) {
  const host = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <p class="msg">${escapeHtml(message)}</p>
    <button class="btn icon" aria-label="Cerrar notificación">✕</button>
  `;
  const btn = el.querySelector("button");
  btn.addEventListener("click", () => el.remove());
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function clampInt(v, def = 0) {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

function calcFinalPrice(basePrice, extra, discountPercent) {
  const pre = basePrice + extra;
  const disc = Math.max(0, Math.min(100, discountPercent || 0));
  const final = Math.round(pre * (1 - disc / 100));
  return { pre, final, disc };
}

/** State */
let allProducts = []; // with sizes embedded
let filtered = [];

const state = {
  q: "",
  category: "",
  sort: "featured",
  featuredOnly: "all",
  priceCap: null,
  modalProduct: null,
  modalSizeId: null,
  modalColor: null,
};

const CART_KEY = "accessories_cart_v1";

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
  catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}
function cartKey(item) {
  return `${item.product_id}__${item.size_id}__${item.color}`;
}
function cartCount(cart) {
  return cart.reduce((sum, it) => sum + it.qty, 0);
}

/** Shipping rule (simple) */
function calcShipping(subtotal) {
  if (subtotal <= 0) return 0;
  // Simulado: envío fijo, gratis si supera 150k
  return subtotal >= 150000 ? 0 : 12000;
}

/** Data loading */
async function fetchCatalog() {
  $("loadingBar").classList.remove("hidden");
  $("emptyState").classList.add("hidden");
  $("productsGrid").innerHTML = "";
  $("resultCount").textContent = "Cargando…";

  // Products: public read
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (pErr) {
    $("loadingBar").classList.add("hidden");
    toast(`Error cargando productos: ${pErr.message}`, "error", 4000);
    $("resultCount").textContent = "Error";
    return;
  }

  // Sizes: public read
  const { data: sizes, error: sErr } = await supabase
    .from("product_sizes")
    .select("id,product_id,label,extra_price")
    .order("label", { ascending: true });

  if (sErr) {
    $("loadingBar").classList.add("hidden");
    toast(`Error cargando tallas: ${sErr.message}`, "error", 4000);
    $("resultCount").textContent = "Error";
    return;
  }

  const byProduct = new Map();
  for (const s of sizes || []) {
    if (!byProduct.has(s.product_id)) byProduct.set(s.product_id, []);
    byProduct.get(s.product_id).push(s);
  }

  allProducts = (products || []).map(p => ({
    ...p,
    sizes: (byProduct.get(p.id) || []).sort((a,b) => a.extra_price - b.extra_price)
  }));

  $("loadingBar").classList.add("hidden");
  applyFiltersRender();
}

/** Filtering/sorting */
function applyFiltersRender() {
  const q = state.q.trim().toLowerCase();
  let items = [...allProducts];

  if (q) {
    items = items.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q) ||
      (p.desc || "").toLowerCase().includes(q)
    );
  }

  if (state.category) {
    items = items.filter(p => (p.category || "").toLowerCase() === state.category);
  }

  if (state.featuredOnly === "yes") {
    items = items.filter(p => !!p.featured);
  }

  if (Number.isFinite(state.priceCap) && state.priceCap > 0) {
    items = items.filter(p => {
      const minExtra = (p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0);
      const { final } = calcFinalPrice(p.base_price || 0, minExtra, p.discount_percent || 0);
      return final <= state.priceCap;
    });
  }

  // Sorting
  const sort = state.sort;
  items.sort((a,b) => {
    if (sort === "featured") {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      // then newest
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }

    const minA = (a.sizes?.length ? Math.min(...a.sizes.map(s => s.extra_price || 0)) : 0);
    const minB = (b.sizes?.length ? Math.min(...b.sizes.map(s => s.extra_price || 0)) : 0);
    const priceA = calcFinalPrice(a.base_price || 0, minA, a.discount_percent || 0).final;
    const priceB = calcFinalPrice(b.base_price || 0, minB, b.discount_percent || 0).final;

    if (sort === "price_asc") return priceA - priceB;
    if (sort === "price_desc") return priceB - priceA;

    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    if (sort === "name_asc") return nameA.localeCompare(nameB, "es");
    if (sort === "name_desc") return nameB.localeCompare(nameA, "es");
    return 0;
  });

  filtered = items;
  renderGrid();
}

function renderGrid() {
  const grid = $("productsGrid");
  grid.innerHTML = "";

  $("resultCount").textContent = `${filtered.length} producto(s)`;

  if (!filtered.length) {
    $("emptyState").classList.remove("hidden");
    return;
  }
  $("emptyState").classList.add("hidden");

  for (const p of filtered) {
    const minExtra = (p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0);
    const { pre, final, disc } = calcFinalPrice(p.base_price || 0, minExtra, p.discount_percent || 0);

    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="cardMedia">
        <img src="${escapeHtml(p.image_url || fallbackImg())}" alt="${escapeHtml(p.name || "Producto")}" loading="lazy" />
      </div>
      <div class="cardBody">
        <div class="cardBadges">
          <span class="badge category">${escapeHtml((p.category || "accesorios").toLowerCase())}</span>
          ${p.featured ? `<span class="badge featured">Destacado</span>` : ""}
          ${disc > 0 ? `<span class="badge discount">-${disc}%</span>` : ""}
        </div>

        <h3 class="cardTitle">${escapeHtml(p.name || "Producto")}</h3>

        <div class="priceRow" aria-label="Precio">
          <div>
            <div class="muted tiny">Desde</div>
            <div class="row" style="gap:10px; align-items:baseline;">
              <div class="priceMain">${fmtCOP.format(final)}</div>
              ${disc > 0 ? `<div class="priceOld">${fmtCOP.format(pre)}</div>` : ""}
            </div>
          </div>
          <span class="badge">COP</span>
        </div>

        <div class="cardActions">
          <button class="btn primary block" aria-label="Ver detalles">Ver</button>
        </div>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => openModal(p.id));
    grid.appendChild(card);
  }
}

function fallbackImg() {
  // Placeholder ultra-ligero (data URI SVG)
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="675">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#7c5cff" stop-opacity=".35" offset="0"/>
          <stop stop-color="#22c55e" stop-opacity=".18" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="#0b0c10"/>
      <rect x="40" y="40" width="820" height="595" rx="36" fill="url(#g)" stroke="rgba(255,255,255,.08)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        fill="rgba(238,241,255,.75)" font-family="system-ui,Segoe UI,Roboto" font-size="28" font-weight="800">
        ACCESORIOS
      </text>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle"
        fill="rgba(238,241,255,.45)" font-family="system-ui,Segoe UI,Roboto" font-size="16">
        imagen pendiente
      </text>
    </svg>
  `);
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

/** Modal */
function openModal(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;

  state.modalProduct = p;

  $("modalTitle").textContent = p.name || "Producto";
  $("modalDesc").textContent = p.desc || "Sin descripción.";
  $("modalImg").src = p.image_url || fallbackImg();
  $("modalImg").alt = p.name || "Producto";

  // badges
  const badges = [];
  badges.push(`<span class="badge category">${escapeHtml(p.category || "accesorios")}</span>`);
  if (p.featured) badges.push(`<span class="badge featured">Destacado</span>`);
  if ((p.discount_percent || 0) > 0) badges.push(`<span class="badge discount">-${p.discount_percent}%</span>`);
  $("modalBadges").innerHTML = badges.join("");

  // size select
  const sizeSelect = $("sizeSelect");
  sizeSelect.innerHTML = "";
  const sizes = (p.sizes?.length ? p.sizes : [{ id: "no-size", product_id: p.id, label: "Única", extra_price: 0 }]);
  for (const s of sizes) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.label}${s.extra_price ? ` (+${fmtCOP.format(s.extra_price)})` : ""}`;
    sizeSelect.appendChild(opt);
  }
  state.modalSizeId = sizes[0].id;

  // color select
  const colorSelect = $("colorSelect");
  colorSelect.innerHTML = "";
  const colors = (Array.isArray(p.colors) && p.colors.length) ? p.colors : ["Negro"];
  for (const c of colors) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    colorSelect.appendChild(opt);
  }
  state.modalColor = colors[0];

  sizeSelect.onchange = () => {
    state.modalSizeId = sizeSelect.value;
    updateModalPrice();
  };
  colorSelect.onchange = () => {
    state.modalColor = colorSelect.value;
  };

  updateModalPrice();

  $("modalBackdrop").classList.add("open");
  $("productModal").classList.add("open");
  $("modalBackdrop").setAttribute("aria-hidden", "false");

  // focus
  setTimeout(() => $("addToCartBtn").focus(), 0);
}

function closeModal() {
  $("modalBackdrop").classList.remove("open");
  $("productModal").classList.remove("open");
  $("modalBackdrop").setAttribute("aria-hidden", "true");
  state.modalProduct = null;
  state.modalSizeId = null;
  state.modalColor = null;
}

function updateModalPrice() {
  const p = state.modalProduct;
  if (!p) return;
  const size = (p.sizes?.length ? p.sizes.find(s => s.id === state.modalSizeId) : null) || { extra_price: 0, label: "Única", id: "no-size" };
  const { pre, final, disc } = calcFinalPrice(p.base_price || 0, size.extra_price || 0, p.discount_percent || 0);

  $("modalPrice").textContent = fmtCOP.format(final);

  if (disc > 0) {
    $("modalOldPrice").classList.remove("hidden");
    $("modalOldPrice").textContent = fmtCOP.format(pre);
    $("modalDiscountHint").classList.remove("hidden");
    $("modalDiscountHint").textContent = `-${disc}%`;
  } else {
    $("modalOldPrice").classList.add("hidden");
    $("modalDiscountHint").classList.add("hidden");
  }

  $("modalFormula").textContent = `(${fmtCOP.format(p.base_price || 0)} + ${fmtCOP.format(size.extra_price || 0)}) → descuento ${disc}%`;
}

/** Cart UI */
function openCart() {
  $("drawerBackdrop").classList.add("open");
  $("cartDrawer").classList.add("open");
  $("cartDrawer").setAttribute("aria-hidden", "false");
  $("drawerBackdrop").setAttribute("aria-hidden", "false");
}
function closeCart() {
  $("drawerBackdrop").classList.remove("open");
  $("cartDrawer").classList.remove("open");
  $("cartDrawer").setAttribute("aria-hidden", "true");
  $("drawerBackdrop").setAttribute("aria-hidden", "true");
}

function renderCart() {
  const cart = loadCart();
  $("cartCount").textContent = String(cartCount(cart));

  const host = $("cartItems");
  host.innerHTML = "";

  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "panel";
    empty.innerHTML = `
      <h2 style="margin:0 0 6px;">Carrito vacío</h2>
      <p class="muted" style="margin:0;">Agrega un producto para empezar.</p>
    `;
    host.appendChild(empty);

    $("cartSubtotal").textContent = fmtCOP.format(0);
    $("cartShipping").textContent = fmtCOP.format(0);
    $("cartTotal").textContent = fmtCOP.format(0);
    return;
  }

  let subtotal = 0;

  for (const it of cart) {
    const p = allProducts.find(x => x.id === it.product_id);
    const size = p?.sizes?.find(s => s.id === it.size_id) || { extra_price: 0, label: "Única" };

    const { final } = calcFinalPrice(p?.base_price || 0, size.extra_price || 0, p?.discount_percent || 0);
    const line = final * it.qty;
    subtotal += line;

    const el = document.createElement("div");
    el.className = "cartItem";
    el.innerHTML = `
      <div class="cartItemTop">
        <div class="cartThumb">
          <img src="${escapeHtml(p?.image_url || fallbackImg())}" alt="${escapeHtml(p?.name || "Producto")}" />
        </div>
        <div class="cartMeta">
          <p class="name">${escapeHtml(p?.name || "Producto")}</p>
          <p class="variant">Talla: ${escapeHtml(size.label)} · Color: ${escapeHtml(it.color)}</p>
          <p class="muted tiny" style="margin:6px 0 0;">
            ${fmtCOP.format(final)} c/u
          </p>
        </div>
      </div>

      <div class="qtyRow">
        <div class="qtyControls" aria-label="Cantidad">
          <button class="btn" aria-label="Disminuir">-</button>
          <div class="qtyNumber" aria-label="Cantidad actual">${it.qty}</div>
          <button class="btn" aria-label="Aumentar">+</button>
        </div>
        <div class="row" style="gap:10px;">
          <strong>${fmtCOP.format(line)}</strong>
          <button class="btn danger" aria-label="Eliminar">Eliminar</button>
        </div>
      </div>
    `;

    const [minusBtn, plusBtn] = el.querySelectorAll(".qtyControls .btn");
    const delBtn = el.querySelector(".btn.danger");

    minusBtn.addEventListener("click", () => updateCartQty(it, -1));
    plusBtn.addEventListener("click", () => updateCartQty(it, +1));
    delBtn.addEventListener("click", () => removeFromCart(it));

    host.appendChild(el);
  }

  const shipping = calcShipping(subtotal);
  const total = subtotal + shipping;

  $("cartSubtotal").textContent = fmtCOP.format(subtotal);
  $("cartShipping").textContent = fmtCOP.format(shipping);
  $("cartTotal").textContent = fmtCOP.format(total);
}

function addToCart(product, sizeId, color) {
  const sizes = (product.sizes?.length ? product.sizes : [{ id: "no-size", extra_price: 0, label: "Única" }]);
  const size = sizes.find(s => s.id === sizeId) || sizes[0];

  const cart = loadCart();
  const item = {
    product_id: product.id,
    size_id: size.id,
    color: color || "Negro",
    qty: 1
  };

  const k = cartKey(item);
  const existing = cart.find(x => cartKey(x) === k);
  if (existing) existing.qty += 1;
  else cart.push(item);

  saveCart(cart);
  renderCart();
  toast("Agregado al carrito ✅", "success");
}

function updateCartQty(item, delta) {
  const cart = loadCart();
  const k = cartKey(item);
  const found = cart.find(x => cartKey(x) === k);
  if (!found) return;

  found.qty = Math.max(1, found.qty + delta);
  saveCart(cart);
  renderCart();
}

function removeFromCart(item) {
  let cart = loadCart();
  const k = cartKey(item);
  cart = cart.filter(x => cartKey(x) !== k);
  saveCart(cart);
  renderCart();
  toast("Item eliminado", "warn");
}

/** Events */
function wireEvents() {
  // Filters toggle mobile
  const toggleBtn = $("filtersToggleBtn");
  const body = $("filtersBody");
  let open = true;
  function setOpen(v) {
    open = v;
    toggleBtn.setAttribute("aria-expanded", String(open));
    body.classList.toggle("hidden", !open);
  }
  // mobile-first: abierto, pero el botón permite colapsar
  setOpen(true);

  toggleBtn.addEventListener("click", () => setOpen(!open));

  $("searchInput").addEventListener("input", (e) => {
    state.q = e.target.value || "";
    applyFiltersRender();
  });

  $("categorySelect").addEventListener("change", (e) => {
    state.category = (e.target.value || "").toLowerCase();
    applyFiltersRender();
  });

  $("sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFiltersRender();
  });

  $("featuredOnly").addEventListener("change", (e) => {
    state.featuredOnly = e.target.value;
    applyFiltersRender();
  });

  $("priceCap").addEventListener("input", (e) => {
    const val = clampInt(e.target.value, NaN);
    state.priceCap = Number.isFinite(val) ? val : null;
    applyFiltersRender();
  });

  $("clearFiltersBtn").addEventListener("click", () => {
    state.q = "";
    state.category = "";
    state.sort = "featured";
    state.featuredOnly = "all";
    state.priceCap = null;

    $("searchInput").value = "";
    $("categorySelect").value = "";
    $("sortSelect").value = "featured";
    $("featuredOnly").value = "all";
    $("priceCap").value = "";

    applyFiltersRender();
    toast("Filtros limpiados", "success");
  });

  // Cart
  $("cartOpenBtn").addEventListener("click", () => {
    openCart();
    renderCart();
  });
  $("cartCloseBtn").addEventListener("click", closeCart);
  $("drawerBackdrop").addEventListener("click", closeCart);

  $("clearCartBtn").addEventListener("click", () => {
    saveCart([]);
    renderCart();
    toast("Carrito vacío", "warn");
  });

  $("checkoutBtn").addEventListener("click", () => {
    const cart = loadCart();
    if (!cart.length) return toast("Tu carrito está vacío.", "warn");
    toast("Compra simulada ✅ (aquí iría el pago)", "success", 3200);
  });

  // Modal
  $("modalCloseBtn").addEventListener("click", closeModal);
  $("modalBackdrop").addEventListener("click", closeModal);

  $("addToCartBtn").addEventListener("click", () => {
    const p = state.modalProduct;
    if (!p) return;
    addToCart(p, state.modalSizeId, state.modalColor);
  });

  $("buyNowBtn").addEventListener("click", () => {
    const p = state.modalProduct;
    if (!p) return;
    addToCart(p, state.modalSizeId, state.modalColor);
    closeModal();
    openCart();
    renderCart();
  });

  // ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("productModal").classList.contains("open")) closeModal();
      if ($("cartDrawer").classList.contains("open")) closeCart();
    }
  });
}

(async function init() {
  wireEvents();
  renderCart();
  await fetchCatalog();
})();