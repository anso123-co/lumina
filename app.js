// app.js
import { supabase } from "./supabaseClient.js";

const $ = (q) => document.querySelector(q);
const grid = $("#grid");
const statusBar = $("#statusBar");
const statusText = $("#statusText");
const emptyState = $("#emptyState");
const resultsMeta = $("#resultsMeta");

const searchForm = $("#searchForm");
const searchInput = $("#searchInput");
const filtersToggle = $("#filtersToggle");
const filtersPanel = $("#filtersPanel");
const categorySelect = $("#categorySelect");
const sortSelect = $("#sortSelect");
const featuredOnly = $("#featuredOnly");
const maxPrice = $("#maxPrice");
const clearFiltersBtn = $("#clearFilters");

const yearEl = $("#year");

const cartBtn = $("#cartBtn");
const cartCount = $("#cartCount");
const cartDrawer = $("#cartDrawer");
const drawerBackdrop = $("#drawerBackdrop");
const closeCart = $("#closeCart");
const cartItemsEl = $("#cartItems");
const subtotalEl = $("#subtotal");
const shippingEl = $("#shipping");
const totalEl = $("#total");
const clearCartBtn = $("#clearCart");
const checkoutBtn = $("#checkout");

const modal = $("#productModal");
const modalBackdrop = $("#modalBackdrop");
const modalPanel = modal?.querySelector(".modalPanel");
const closeModalBtn = $("#closeModal");
const modalTitle = $("#modalTitle");
const modalImg = $("#modalImg");
const modalBadges = $("#modalBadges");
const modalDesc = $("#modalDesc");
const modalSize = $("#modalSize");
const modalColor = $("#modalColor");
const modalPrice = $("#modalPrice");
const modalStrike = $("#modalStrike");
const qtyMinus = $("#qtyMinus");
const qtyPlus = $("#qtyPlus");
const qtyValue = $("#qtyValue");
const addToCartBtn = $("#addToCart");
const buyNowBtn = $("#buyNow");

const logoBtn = $("#logoBtn");

const toastHost = $("#toastHost");

let PRODUCTS = [];      // products rows
let SIZES = [];         // product_sizes rows
let view = [];          // filtered list
let openProduct = null; // current modal product
let openQty = 1;

const CART_KEY = "lumina_cart_v1";

function moneyCOP(n){
  const val = Number(n || 0);
  return val.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function toast(title, msg, variant=""){
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="tiny">${escapeHtml(msg)}</div>`;
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// ---------- Admin Hidden Access ----------
function goAdmin(){
  // limpiar input y navegar con delay para Android
  try { searchInput.value = ""; } catch {}
  setTimeout(() => { window.location.href = "./admin.html"; }, 140);
}

function watchAdminKeyword(value){
  const v = (value || "").trim().toLowerCase();
  if(v === "admin"){
    toast("Acceso admin", "Abriendo panel…");
    goAdmin();
  }
}

// Detectar input/change/submit/search (Android)
["input","change"].forEach(evt => {
  searchInput.addEventListener(evt, (e) => watchAdminKeyword(e.target.value));
});
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  watchAdminKeyword(searchInput.value);
  applyFilters();
});
searchInput.addEventListener("search", (e) => { // evento nativo de input type="search"
  watchAdminKeyword(e.target.value);
  applyFilters();
});
// (Opcional desktop) teclado
document.addEventListener("keydown", (e) => {
  if(e.key === "Enter" && document.activeElement === searchInput){
    watchAdminKeyword(searchInput.value);
  }
});

// Long-press logo 1200ms (pointerdown/up)
let pressTimer = null;
logoBtn.addEventListener("pointerdown", () => {
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    toast("Acceso admin", "Long-press detectado…");
    goAdmin();
  }, 1200);
});
["pointerup","pointercancel","pointerleave"].forEach(evt => {
  logoBtn.addEventListener(evt, () => clearTimeout(pressTimer));
});

// ---------- Drawer / Modal Accessibility ----------
function openDrawer(){
  cartDrawer.classList.add("open");
  cartDrawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderCart();
}
function closeDrawer(){
  cartDrawer.classList.remove("open");
  cartDrawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openModal(product){
  openProduct = product;
  openQty = 1;
  qtyValue.textContent = String(openQty);

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  // Focus
  setTimeout(() => modalPanel?.focus(), 0);

  renderModal(product);
}
function closeModal(){
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  openProduct = null;
}

function onGlobalEsc(e){
  if(e.key !== "Escape") return;
  if(!modal.hidden) closeModal();
  if(cartDrawer.classList.contains("open")) closeDrawer();
}
document.addEventListener("keydown", onGlobalEsc);

cartBtn.addEventListener("click", openDrawer);
closeCart.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

closeModalBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

filtersToggle.addEventListener("click", () => {
  const isOpen = !filtersPanel.hasAttribute("hidden");
  if(isOpen){
    filtersPanel.setAttribute("hidden", "");
    filtersToggle.setAttribute("aria-expanded", "false");
  }else{
    filtersPanel.removeAttribute("hidden");
    filtersToggle.setAttribute("aria-expanded", "true");
  }
});

clearFiltersBtn.addEventListener("click", () => {
  searchInput.value = "";
  categorySelect.value = "";
  featuredOnly.checked = false;
  maxPrice.value = "";
  sortSelect.value = "featured_recent";
  applyFilters();
});

// ---------- Data Load ----------
async function loadCatalog(){
  statusBar.hidden = false;
  statusText.textContent = "Cargando productos…";
  emptyState.hidden = true;
  grid.innerHTML = "";

  // products
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,image_path,created_at,updated_at")
    .order("created_at", { ascending: false });

  if(pErr){
    statusText.textContent = "Error cargando productos";
    toast("Error", pErr.message || "No se pudo cargar");
    return;
  }

  // sizes
  const { data: sizes, error: sErr } = await supabase
    .from("product_sizes")
    .select("id,product_id,label,extra_price");

  if(sErr){
    toast("Error", sErr.message || "No se pudo cargar tallas");
  }

  PRODUCTS = products || [];
  SIZES = sizes || [];
  applyFilters();
}

function sizesFor(productId){
  return SIZES.filter(s => s.product_id === productId).sort((a,b)=> (a.extra_price||0)-(b.extra_price||0));
}

function computeFromPrice(product){
  const base = Number(product.base_price || 0);
  const sizes = sizesFor(product.id);
  const minExtra = sizes.length ? Number(sizes[0].extra_price || 0) : 0;
  const raw = base + minExtra;
  const disc = clamp(Number(product.discount_percent || 0), 0, 100);
  const final = Math.round(raw * (1 - disc/100));
  return { raw, final };
}

function applyFilters(){
  const q = (searchInput.value || "").trim().toLowerCase();
  const cat = categorySelect.value;
  const feat = featuredOnly.checked;
  const max = maxPrice.value ? Number(maxPrice.value) : null;

  view = PRODUCTS.filter(p => {
    const hay = (
      (p.name || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q) ||
      (p.desc || "").toLowerCase().includes(q)
    );

    if(q && !hay) return false;
    if(cat && p.category !== cat) return false;
    if(feat && !p.featured) return false;

    if(max != null && !Number.isNaN(max)){
      const { final } = computeFromPrice(p);
      if(final > max) return false;
    }

    return true;
  });

  // Sort
  const sort = sortSelect.value;
  view.sort((a,b) => {
    const pa = computeFromPrice(a).final;
    const pb = computeFromPrice(b).final;

    if(sort === "featured_recent"){
      // featured first, then created_at desc
      const fa = a.featured ? 1 : 0;
      const fb = b.featured ? 1 : 0;
      if(fa !== fb) return fb - fa;
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if(sort === "price_asc") return pa - pb;
    if(sort === "price_desc") return pb - pa;
    if(sort === "name_asc") return (a.name||"").localeCompare(b.name||"", "es");
    if(sort === "name_desc") return (b.name||"").localeCompare(a.name||"", "es");
    return 0;
  });

  renderGrid();
}

[categorySelect, sortSelect, featuredOnly, maxPrice].forEach(el => {
  el.addEventListener("change", applyFilters);
  el.addEventListener("input", applyFilters);
});

searchForm.addEventListener("submit", (e)=> {
  e.preventDefault();
  applyFilters();
});

function setStatus(text){
  statusText.textContent = text;
  statusBar.hidden = false;
}

function renderGrid(){
  const count = view.length;
  resultsMeta.textContent = `${count} producto${count===1?"":"s"} encontrado${count===1?"":"s"}`;
  yearEl.textContent = String(new Date().getFullYear());

  if(count === 0){
    statusBar.hidden = true;
    emptyState.hidden = false;
    grid.innerHTML = "";
    return;
  }

  emptyState.hidden = true;
  statusBar.hidden = true;

  const frag = document.createDocumentFragment();

  for(const p of view){
    const { raw, final } = computeFromPrice(p);

    const card = document.createElement("article");
    card.className = "card pCard";
    card.setAttribute("aria-label", `Producto ${p.name}`);

    const media = document.createElement("div");
    media.className = "media";

    if(p.image_url){
      const img = document.createElement("img");
      img.src = p.image_url;
      img.alt = p.name || "Producto";
      img.loading = "lazy";
      img.decoding = "async";
      media.appendChild(img);
    }else{
      const ph = document.createElement("div");
      ph.className = "placeholder";
      ph.textContent = "✨";
      media.appendChild(ph);
    }

    const body = document.createElement("div");
    body.className = "cardBody";

    const titleRow = document.createElement("div");
    titleRow.className = "cardTitleRow";

    const left = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "pName";
    name.textContent = p.name || "Sin nombre";
    left.appendChild(name);

    const badges = document.createElement("div");
    badges.className = "badges";

    // category badge
    badges.appendChild(makeBadge(p.category || "—", "cool"));

    // featured
    if(p.featured) badges.appendChild(makeBadge("Destacado", "hot"));

    // discount
    const disc = clamp(Number(p.discount_percent || 0), 0, 100);
    if(disc > 0) badges.appendChild(makeBadge(`-${disc}%`, "sale"));

    titleRow.appendChild(left);
    titleRow.appendChild(badges);

    const bottom = document.createElement("div");
    bottom.className = "cardBottom";

    const priceFrom = document.createElement("div");
    priceFrom.className = "priceFrom";
    priceFrom.innerHTML = `
      <span class="tiny muted">Desde</span>
      <div>
        <strong class="price">${moneyCOP(final)}</strong>
        ${disc > 0 ? `<span class="strike muted">${moneyCOP(raw)}</span>` : ``}
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "btn btnSoft btnSm";
    btn.textContent = "Ver";
    btn.setAttribute("aria-label", `Ver ${p.name}`);
    btn.addEventListener("click", () => openModal(p));

    bottom.appendChild(priceFrom);
    bottom.appendChild(btn);

    body.appendChild(titleRow);

    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = (p.desc || "").slice(0, 90) + ((p.desc||"").length > 90 ? "…" : "");
    body.appendChild(desc);

    body.appendChild(bottom);

    card.appendChild(media);
    card.appendChild(body);

    frag.appendChild(card);
  }

  grid.innerHTML = "";
  grid.appendChild(frag);
}

function makeBadge(text, kind=""){
  const b = document.createElement("span");
  b.className = `badge ${kind}`.trim();
  b.textContent = text;
  return b;
}

// ---------- Modal ----------
function colorsFor(product){
  const arr = Array.isArray(product.colors) ? product.colors : [];
  const cleaned = arr.map(x => String(x).trim()).filter(Boolean);
  return cleaned.length ? cleaned : ["Único"];
}

function renderModal(p){
  modalTitle.textContent = p.name || "Producto";
  modalDesc.textContent = p.desc || "Sin descripción";

  // image
  if(p.image_url){
    modalImg.src = p.image_url;
    modalImg.alt = p.name || "Producto";
  }else{
    // placeholder inline: set to empty + background will show
    modalImg.removeAttribute("src");
    modalImg.alt = "Sin imagen";
  }

  // badges
  modalBadges.innerHTML = "";
  modalBadges.appendChild(makeBadge(p.category || "—", "cool"));
  if(p.featured) modalBadges.appendChild(makeBadge("Destacado", "hot"));
  const disc = clamp(Number(p.discount_percent || 0), 0, 100);
  if(disc > 0) modalBadges.appendChild(makeBadge(`-${disc}%`, "sale"));

  // sizes
  const sizes = sizesFor(p.id);
  modalSize.innerHTML = "";
  const safeSizes = sizes.length ? sizes : [{ id: "na", label: "Única", extra_price: 0 }];
  for(const s of safeSizes){
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.label}${Number(s.extra_price||0) ? ` (+${moneyCOP(s.extra_price)})` : ""}`;
    opt.dataset.extra = String(s.extra_price || 0);
    opt.dataset.label = s.label;
    modalSize.appendChild(opt);
  }

  // colors
  const colors = colorsFor(p);
  modalColor.innerHTML = "";
  for(const c of colors){
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    modalColor.appendChild(opt);
  }

  // price compute
  updateModalPrice();
}

function updateModalPrice(){
  if(!openProduct) return;
  const base = Number(openProduct.base_price || 0);
  const disc = clamp(Number(openProduct.discount_percent || 0), 0, 100);
  const sizeExtra = Number(modalSize.selectedOptions[0]?.dataset?.extra || 0);
  const raw = base + sizeExtra;
  const final = Math.round(raw * (1 - disc/100));

  modalPrice.textContent = moneyCOP(final);
  if(disc > 0){
    modalStrike.hidden = false;
    modalStrike.textContent = moneyCOP(raw);
  }else{
    modalStrike.hidden = true;
    modalStrike.textContent = "";
  }
}

modalSize.addEventListener("change", updateModalPrice);
modalColor.addEventListener("change", updateModalPrice);

qtyMinus.addEventListener("click", () => {
  openQty = clamp(openQty - 1, 1, 99);
  qtyValue.textContent = String(openQty);
});
qtyPlus.addEventListener("click", () => {
  openQty = clamp(openQty + 1, 1, 99);
  qtyValue.textContent = String(openQty);
});

// ---------- Cart ----------
function readCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if(Array.isArray(arr)) return arr;
    return [];
  }catch{ return []; }
}
function writeCart(items){
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartCount();
}
function updateCartCount(){
  const cart = readCart();
  const totalQty = cart.reduce((a,it)=> a + Number(it.qty||0), 0);
  cartCount.textContent = String(totalQty);
}

function addToCart(product, sizeId, sizeLabel, color, qty){
  const cart = readCart();
  const key = `${product.id}::${sizeId}::${color}`;
  const idx = cart.findIndex(x => `${x.product_id}::${x.size_id}::${x.color}` === key);
  if(idx >= 0){
    cart[idx].qty = clamp(Number(cart[idx].qty||0) + qty, 1, 99);
  }else{
    cart.push({
      product_id: product.id,
      size_id: sizeId,
      size_label: sizeLabel,
      color,
      qty
    });
  }
  writeCart(cart);
}

function removeCartItem(index){
  const cart = readCart();
  cart.splice(index, 1);
  writeCart(cart);
  renderCart();
}

function setCartQty(index, qty){
  const cart = readCart();
  if(!cart[index]) return;
  cart[index].qty = clamp(qty, 1, 99);
  writeCart(cart);
  renderCart();
}

function clearCart(){
  writeCart([]);
  renderCart();
}

clearCartBtn.addEventListener("click", () => {
  clearCart();
  toast("Carrito", "Vaciado");
});

checkoutBtn.addEventListener("click", () => {
  const cart = readCart();
  if(cart.length === 0){
    toast("Carrito vacío", "Agrega productos para continuar");
    return;
  }
  toast("Compra simulada", "¡Listo! (Aquí iría tu checkout real)");
});

addToCartBtn.addEventListener("click", () => {
  if(!openProduct) return;
  const sOpt = modalSize.selectedOptions[0];
  const sizeId = modalSize.value;
  const sizeLabel = sOpt?.dataset?.label || sOpt?.textContent || "Única";
  const color = modalColor.value || "Único";

  addToCart(openProduct, sizeId, sizeLabel, color, openQty);
  toast("Agregado", `${openProduct.name} ×${openQty}`);
  renderCart();
});

buyNowBtn.addEventListener("click", () => {
  addToCartBtn.click();
  closeModal();
  openDrawer();
});

function calcItemPrice(product, sizeId){
  const base = Number(product.base_price || 0);
  const disc = clamp(Number(product.discount_percent || 0), 0, 100);
  const size = SIZES.find(s => s.id === sizeId);
  const extra = Number(size?.extra_price || 0);
  const raw = base + extra;
  const final = Math.round(raw * (1 - disc/100));
  return { raw, final };
}

function renderCart(){
  const cart = readCart();
  if(!cartDrawer.classList.contains("open")) return;

  cartItemsEl.innerHTML = "";
  if(cart.length === 0){
    cartItemsEl.innerHTML = `
      <div class="emptyState" style="margin:0;">
        <div class="emptyIcon" aria-hidden="true">🛒</div>
        <div class="emptyTitle">Tu carrito está vacío</div>
        <div class="emptySub">Agrega algo lindo 😄</div>
      </div>
    `;
    subtotalEl.textContent = moneyCOP(0);
    shippingEl.textContent = moneyCOP(0);
    totalEl.textContent = moneyCOP(0);
    return;
  }

  let subtotal = 0;

  cart.forEach((it, idx) => {
    const p = PRODUCTS.find(x => x.id === it.product_id);
    if(!p) return;

    const { final } = calcItemPrice(p, it.size_id);
    const qty = Number(it.qty || 1);
    subtotal += final * qty;

    const row = document.createElement("div");
    row.className = "cartItem";

    const thumb = document.createElement("div");
    thumb.className = "cartThumb";
    if(p.image_url){
      const img = document.createElement("img");
      img.src = p.image_url;
      img.alt = p.name || "Producto";
      img.loading = "lazy";
      img.decoding = "async";
      thumb.appendChild(img);
    }else{
      thumb.textContent = "✨";
    }

    const meta = document.createElement("div");
    meta.className = "cartMeta";
    meta.innerHTML = `
      <p class="cartName">${escapeHtml(p.name || "Producto")}</p>
      <div class="cartVar">${escapeHtml(it.size_label || "Única")} • ${escapeHtml(it.color || "Único")}</div>
      <div class="cartPrice">${moneyCOP(final)} c/u</div>
    `;

    const right = document.createElement("div");
    right.className = "cartRight";

    const qtyCtrl = document.createElement("div");
    qtyCtrl.className = "qtyCtrl";

    const minus = document.createElement("button");
    minus.className = "iconBtn";
    minus.textContent = "−";
    minus.setAttribute("aria-label","Disminuir cantidad");
    minus.addEventListener("click", () => setCartQty(idx, qty - 1));

    const qv = document.createElement("span");
    qv.className = "qtyValue";
    qv.textContent = String(qty);

    const plus = document.createElement("button");
    plus.className = "iconBtn";
    plus.textContent = "+";
    plus.setAttribute("aria-label","Aumentar cantidad");
    plus.addEventListener("click", () => setCartQty(idx, qty + 1));

    qtyCtrl.append(minus, qv, plus);

    const del = document.createElement("but
