import { supabase } from "./supabaseClient.js";

const fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function toast(message, type = "success", ms = 2800) {
  const host = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <p class="msg">${escapeHtml(message)}</p>
    <button class="btn icon" aria-label="Cerrar notificación">✕</button>
  `;
  el.querySelector("button").addEventListener("click", () => el.remove());
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function clampInt(v, def = 0) {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

async function getIsAdmin(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { isAdmin: false, error };
  return { isAdmin: !!data?.is_admin, error: null };
}

/** Editor state */
let sessionUser = null;
let isAdmin = false;

let editingProductId = null;
let currentImageFile = null; // new file to upload
let currentImageUrl = null;
let currentImagePath = null;

let colors = [];
let sizes = []; // [{label, extra_price, id?}]

function resetEditor() {
  editingProductId = null;
  currentImageFile = null;
  currentImageUrl = null;
  currentImagePath = null;
  colors = [];
  sizes = [];

  $("editorTitle").textContent = "Crear producto";
  $("nameInput").value = "";
  $("categoryInput").value = "manillas";
  $("descInput").value = "";
  $("basePriceInput").value = "";
  $("discountInput").value = "";
  $("featuredInput").checked = false;
  $("imageInput").value = "";
  setPreview(null);

  renderPills();
  $("cancelEditBtn").classList.add("hidden");
}

function setPreview(url) {
  const img = $("imagePreview");
  const hint = $("previewHint");
  if (!url) {
    img.classList.add("hidden");
    hint.classList.remove("hidden");
    img.src = "";
    return;
  }
  img.src = url;
  img.classList.remove("hidden");
  hint.classList.add("hidden");
}

function renderPills() {
  // colors
  const hostC = $("colorsPills");
  const inputC = $("colorAddInput");
  hostC.querySelectorAll(".pill").forEach(p => p.remove());
  for (const c of colors) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.innerHTML = `
      <span>${escapeHtml(c)}</span>
      <button aria-label="Quitar color">✕</button>
    `;
    pill.querySelector("button").addEventListener("click", () => {
      colors = colors.filter(x => x !== c);
      renderPills();
    });
    hostC.insertBefore(pill, inputC);
  }

  // sizes
  const hostS = $("sizesPills");
  const inputS = $("sizeAddInput");
  hostS.querySelectorAll(".pill").forEach(p => p.remove());
  for (const s of sizes) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.innerHTML = `
      <span>${escapeHtml(s.label)} (+${escapeHtml(String(s.extra_price))})</span>
      <button aria-label="Quitar talla">✕</button>
    `;
    pill.querySelector("button").addEventListener("click", () => {
      sizes = sizes.filter(x => x !== s);
      renderPills();
    });
    hostS.insertBefore(pill, inputS);
  }
}

/** Storage helpers */
function makeImagePath(productId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safe = `${Date.now()}_${Math.random().toString(16).slice(2)}`.slice(0, 30);
  return `products/${productId}/${safe}.${ext}`;
}

async function uploadImageIfNeeded(productId) {
  if (!currentImageFile) return { image_url: currentImageUrl, image_path: currentImagePath };

  // if editing and old image exists -> delete old first (optional safe)
  if (currentImagePath) {
    await supabase.storage.from("product-images").remove([currentImagePath]);
  }

  const path = makeImagePath(productId, currentImageFile);

  const { error: upErr } = await supabase.storage
    .from("product-images")
    .upload(path, currentImageFile, {
      upsert: true,
      cacheControl: "3600",
      contentType: currentImageFile.type
    });

  if (upErr) throw upErr;

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  const publicUrl = data?.publicUrl;

  return { image_url: publicUrl, image_path: path };
}

async function deleteImageIfExists(path) {
  if (!path) return;
  await supabase.storage.from("product-images").remove([path]);
}

/** DB operations */
async function fetchAllProducts() {
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,image_path,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (pErr) throw pErr;

  const { data: sizes, error: sErr } = await supabase
    .from("product_sizes")
    .select("id,product_id,label,extra_price");

  if (sErr) throw sErr;

  const byProduct = new Map();
  for (const s of sizes || []) {
    if (!byProduct.has(s.product_id)) byProduct.set(s.product_id, []);
    byProduct.get(s.product_id).push(s);
  }

  return (products || []).map(p => ({ ...p, sizes: byProduct.get(p.id) || [] }));
}

function renderProductList(rows) {
  const host = $("productsList");
  host.innerHTML = "";

  if (!rows.length) {
    const el = document.createElement("div");
    el.className = "panel";
    el.innerHTML = `<p class="muted" style="margin:0;">No hay productos.</p>`;
    host.appendChild(el);
    return;
  }

  for (const p of rows) {
    const el = document.createElement("div");
    el.className = "prodRow";

    const minExtra = p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0;
    const pre = (p.base_price || 0) + minExtra;
    const disc = Math.max(0, Math.min(100, p.discount_percent || 0));
    const final = Math.round(pre * (1 - disc / 100));

    el.innerHTML = `
      <div class="prodRowTop">
        <div class="prodRowThumb">
          <img src="${escapeHtml(p.image_url || "")}" alt="${escapeHtml(p.name || "Producto")}" />
        </div>
        <div class="prodRowMeta">
          <p class="name">${escapeHtml(p.name || "Producto")}</p>
          <p class="sub">
            ${escapeHtml(p.category || "")}
            ${p.featured ? " · Destacado" : ""}
            ${disc > 0 ? ` · -${disc}%` : ""}
            · Desde ${fmtCOP.format(final)}
          </p>
        </div>
      </div>
      <div class="prodRowActions">
        <button class="btn" aria-label="Editar">Editar</button>
        <button class="btn danger" aria-label="Eliminar">Eliminar</button>
      </div>
    `;

    const [editBtn, delBtn] = el.querySelectorAll("button");
    editBtn.addEventListener("click", () => loadIntoEditor(p));
    delBtn.addEventListener("click", () => deleteProductFlow(p));

    host.appendChild(el);
  }
}

function loadIntoEditor(p) {
  editingProductId = p.id;
  $("editorTitle").textContent = "Editar producto";
  $("cancelEditBtn").classList.remove("hidden");

  $("nameInput").value = p.name || "";
  $("categoryInput").value = (p.category || "manillas").toLowerCase();
  $("descInput").value = p.desc || "";
  $("basePriceInput").value = String(p.base_price ?? "");
  $("discountInput").value = String(p.discount_percent ?? 0);
  $("featuredInput").checked = !!p.featured;

  colors = Array.isArray(p.colors) ? [...p.colors] : [];
  sizes = (p.sizes || []).map(s => ({ id: s.id, label: s.label, extra_price: s.extra_price || 0 }));

  currentImageUrl = p.image_url || null;
  currentImagePath = p.image_path || null;
  currentImageFile = null;
  setPreview(currentImageUrl);

  renderPills();
  toast("Editando producto", "success");
}

async function saveProduct() {
  if (!sessionUser) return toast("No hay sesión.", "error");
  if (!isAdmin) return toast("No eres admin (is_admin=false).", "error", 4000);

  const name = $("nameInput").value.trim();
  const category = $("categoryInput").value.trim().toLowerCase();
  const desc = $("descInput").value.trim();
  const base_price = clampInt($("basePriceInput").value, NaN);
  const discount_percent = clampInt($("discountInput").value, 0);
  const featured = $("featuredInput").checked;

  if (!name) return toast("Nombre requerido.", "warn");
  if (!category) return toast("Categoría requerida.", "warn");
  if (!Number.isFinite(base_price) || base_price < 0) return toast("Precio base inválido.", "warn");

  if (!sizes.length) {
    // mínimo una talla
    sizes = [{ label: "Única", extra_price: 0 }];
  }

  $("saveBtn").disabled = true;
  $("savingHint").textContent = "Guardando…";

  try {
    // 1) upsert product (sin imagen aún)
    let productId = editingProductId;

    if (!productId) {
      // Insert
      const { data, error } = await supabase
        .from("products")
        .insert([{
          name,
          category,
          desc,
          base_price,
          discount_percent: Math.max(0, Math.min(100, discount_percent)),
          featured,
          colors
        }])
        .select("id,image_url,image_path")
        .single();

      if (error) throw error;
      productId = data.id;
      editingProductId = productId;
      currentImageUrl = data.image_url || null;
      currentImagePath = data.image_path || null;
    } else {
      // Update
      const { error } = await supabase
        .from("products")
        .update({
          name,
          category,
          desc,
          base_price,
          discount_percent: Math.max(0, Math.min(100, discount_percent)),
          featured,
          colors
        })
        .eq("id", productId);

      if (error) throw error;
    }

    // 2) upload image if needed, then update product with image_url/path
    const img = await uploadImageIfNeeded(productId);
    if (img?.image_url !== currentImageUrl || img?.image_path !== currentImagePath) {
      const { error } = await supabase
        .from("products")
        .update({ image_url: img.image_url, image_path: img.image_path })
        .eq("id", productId);

      if (error) throw error;

      currentImageUrl = img.image_url;
      currentImagePath = img.image_path;
    }

    // 3) sizes: easiest safe way: delete old sizes then insert new sizes
    // (RLS only admin can do this)
    const { error: delErr } = await supabase
      .from("product_sizes")
      .delete()
      .eq("product_id", productId);

    if (delErr) throw delErr;

    const toInsert = sizes.map(s => ({
      product_id: productId,
      label: s.label,
      extra_price: clampInt(s.extra_price, 0)
    }));

    const { error: insErr } = await supabase
      .from("product_sizes")
      .insert(toInsert);

    if (insErr) throw insErr;

    toast("Guardado ✅", "success");
    await refreshListAndResetIfCreate(false);
  } catch (e) {
    toast(`Error guardando: ${e?.message || e}`, "error", 4500);
  } finally {
    $("saveBtn").disabled = false;
    $("savingHint").textContent = "";
  }
}

async function refreshListAndResetIfCreate(reset = false) {
  const rows = await fetchAllProducts();
  renderProductList(rows);
  if (reset) resetEditor();
}

async function deleteProductFlow(p) {
  if (!sessionUser) return toast("No hay sesión.", "error");
  if (!isAdmin) return toast("No eres admin.", "error", 4000);

  const ok = confirm(`¿Eliminar "${p.name}"?\nSe borrarán tallas, producto e imagen (si existe).`);
  if (!ok) return;

  try {
    // 1) delete image from storage (if exists)
    if (p.image_path) {
      await deleteImageIfExists(p.image_path);
    }

    // 2) delete sizes first (or FK cascade would also work, pero lo hacemos explícito)
    const { error: sErr } = await supabase
      .from("product_sizes")
      .delete()
      .eq("product_id", p.id);
    if (sErr) throw sErr;

    // 3) delete product
    const { error: pErr } = await supabase
      .from("products")
      .delete()
      .eq("id", p.id);
    if (pErr) throw pErr;

    toast("Producto eliminado", "warn");
    await refreshListAndResetIfCreate(editingProductId === p.id);
    if (editingProductId === p.id) resetEditor();
  } catch (e) {
    toast(`Error eliminando: ${e?.message || e}`, "error", 4500);
  }
}

/** Auth + UI */
function showLoggedIn(email) {
  $("adminEmail").textContent = email || "—";
  $("logoutBtn").classList.remove("hidden");
  $("loginPanel").classList.add("hidden");
  $("editorPanel").classList.remove("hidden");
  $("listPanel").classList.remove("hidden");
}

function showLoggedOut() {
  $("adminEmail").textContent = "—";
  $("logoutBtn").classList.add("hidden");
  $("loginPanel").classList.remove("hidden");
  $("editorPanel").classList.add("hidden");
  $("listPanel").classList.add("hidden");
  resetEditor();
}

async function ensureAdminOrBlock(user) {
  const res = await getIsAdmin(user.id);
  if (res.error) {
    toast(`Error verificando admin: ${res.error.message}`, "error", 4500);
    return false;
  }
  if (!res.isAdmin) {
    toast("Tu usuario NO es admin (profiles.is_admin=false).", "error", 5000);
    await supabase.auth.signOut();
    return false;
  }
  return true;
}

function wireEvents() {
  $("loginBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    const password = $("loginPass").value;

    if (!email || !password) return toast("Email y contraseña requeridos.", "warn");

    $("loginBtn").disabled = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      sessionUser = data.user;
      const ok = await ensureAdminOrBlock(sessionUser);
      if (!ok) return;

      isAdmin = true;
      showLoggedIn(sessionUser.email);
      toast("Sesión iniciada ✅", "success");

      await refreshListAndResetIfCreate(true);
    } catch (e) {
      toast(`Login error: ${e?.message || e}`, "error", 4500);
    } finally {
      $("loginBtn").disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    sessionUser = null;
    isAdmin = false;
    showLoggedOut();
    toast("Sesión cerrada", "warn");
  });

  $("refreshBtn").addEventListener("click", async () => {
    try {
      const rows = await fetchAllProducts();
      renderProductList(rows);
      toast("Actualizado", "success");
    } catch (e) {
      toast(`Error actualizando: ${e?.message || e}`, "error", 4500);
    }
  });

  $("saveBtn").addEventListener("click", saveProduct);

  $("cancelEditBtn").addEventListener("click", () => {
    resetEditor();
    toast("Edición cancelada", "warn");
  });

  // Color add
  $("colorAddInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val) return;
    if (colors.includes(val)) return toast("Ese color ya existe.", "warn");
    colors.push(val);
    e.target.value = "";
    renderPills();
  });

  // Size add: "M, 5000"
  $("sizeAddInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const raw = e.target.value.trim();
    if (!raw) return;

    const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length < 1) return toast("Formato inválido.", "warn");

    const label = parts[0];
    const extra = clampInt(parts[1] ?? "0", 0);

    if (sizes.some(s => (s.label || "").toLowerCase() === label.toLowerCase())) {
      return toast("Esa talla ya existe.", "warn");
    }

    sizes.push({ label, extra_price: extra });
    e.target.value = "";
    renderPills();
  });

  // Image preview
  $("imageInput").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      currentImageFile = null;
      setPreview(currentImageUrl);
      return;
    }
    const okType = ["image/jpeg","image/png","image/webp"].includes(file.type);
    if (!okType) {
      $("imageInput").value = "";
      return toast("Formato no permitido. Usa JPG/PNG/WEBP.", "warn");
    }
    currentImageFile = file;
    const url = URL.createObjectURL(file);
    setPreview(url);
  });
}

async function bootstrap() {
  wireEvents();

  // On load: session?
  const { data } = await supabase.auth.getSession();
  const sess = data?.session;

  if (!sess?.user) {
    showLoggedOut();
    return;
  }

  sessionUser = sess.user;
  const ok = await ensureAdminOrBlock(sessionUser);
  if (!ok) {
    showLoggedOut();
    return;
  }

  isAdmin = true;
  showLoggedIn(sessionUser.email);
  toast("Sesión activa ✅", "success");
  try {
    await refreshListAndResetIfCreate(true);
  } catch (e) {
    toast(`Error cargando lista: ${e?.message || e}`, "error", 4500);
  }
}

bootstrap();