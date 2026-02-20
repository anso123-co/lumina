// admin.js
import { supabase } from "./supabaseClient.js";

const $ = (q) => document.querySelector(q);
const toastHost = $("#toastHost");

const loginView = $("#loginView");
const adminView = $("#adminView");

const loginForm = $("#loginForm");
const emailEl = $("#email");
const passEl = $("#password");

const adminEmail = $("#adminEmail");
const logoutBtn = $("#logoutBtn");

const newProductBtn = $("#newProductBtn");
const refreshBtn = $("#refreshBtn");

const editor = $("#editor");
const editorTitle = $("#editorTitle");
const closeEditor = $("#closeEditor");

const productForm = $("#productForm");
const productId = $("#productId");
const pName = $("#pName");
const pCategory = $("#pCategory");
const pDesc = $("#pDesc");
const pBasePrice = $("#pBasePrice");
const pDiscount = $("#pDiscount");
const pFeatured = $("#pFeatured");
const pColors = $("#pColors");
const pSizes = $("#pSizes");
const pImage = $("#pImage");

const imgPreview = $("#imgPreview");
const imgInfo = $("#imgInfo");
const deleteBtn = $("#deleteBtn");
const saveBtn = $("#saveBtn");

const adminList = $("#adminList");
const adminEmpty = $("#adminEmpty");
const adminMeta = $("#adminMeta");

let PRODUCTS = [];
let SIZES = [];
let currentUser = null;
let currentIsAdmin = false;

let currentImageBlob = null; // compressed image blob
let currentImageExt = "webp";
let currentEditProduct = null; // product row being edited

function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function toast(title, msg){
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="tiny">${escapeHtml(msg)}</div>`;
  toastHost.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function moneyCOP(n){
  return Number(n||0).toLocaleString("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0});
}

async function getProfileIsAdmin(uid){
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", uid)
    .maybeSingle();

  if(error) throw error;
  return !!(data && data.is_admin);
}

async function requireAdmin(){
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;

  if(!currentUser){
    currentIsAdmin = false;
    showLogin();
    return;
  }

  try{
    const isAdmin = await getProfileIsAdmin(currentUser.id);
    if(!isAdmin){
      toast("Acceso denegado","Tu usuario no es admin.");
      await supabase.auth.signOut();
      currentIsAdmin = false;
      showLogin();
      return;
    }
    currentIsAdmin = true;
    adminEmail.textContent = currentUser.email || "admin";
    showAdmin();
    await loadAdminData();
  }catch(err){
    toast("Error", err.message || "No se pudo validar admin");
    await supabase.auth.signOut();
    showLogin();
  }
}

function showLogin(){
  loginView.hidden = false;
  adminView.hidden = true;
  adminEmail.textContent = "—";
}
function showAdmin(){
  loginView.hidden = true;
  adminView.hidden = false;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = (emailEl.value || "").trim();
  const password = passEl.value || "";

  if(!email || !password){
    toast("Faltan datos","Email y contraseña");
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error){
    toast("Login falló", error.message || "Revisa tus datos");
    return;
  }
  toast("Listo", "Sesión iniciada");
  currentUser = data.user;
  await requireAdmin();
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  toast("Sesión", "Cerrada");
  showLogin();
});

refreshBtn.addEventListener("click", () => loadAdminData());

newProductBtn.addEventListener("click", () => openEditorForNew());
closeEditor.addEventListener("click", () => closeEditorUI());

deleteBtn.addEventListener("click", async () => {
  if(!currentEditProduct?.id) return;
  const ok = confirm("¿Eliminar este producto? (Esto borra también sus tallas)");
  if(!ok) return;

  // opcional: borrar imagen en storage si existe
  if(currentEditProduct.image_path){
    await safeRemoveStorage(currentEditProduct.image_path);
  }

  const { error } = await supabase.from("products").delete().eq("id", currentEditProduct.id);
  if(error){
    toast("Error", error.message || "No se pudo eliminar");
    return;
  }
  toast("Eliminado", "Producto borrado");
  closeEditorUI();
  await loadAdminData();
});

// ----- Data -----
async function loadAdminData(){
  adminMeta.textContent = "Cargando…";
  adminList.innerHTML = "";

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,image_path,created_at,updated_at")
    .order("created_at", { ascending: false });

  if(pErr){
    toast("Error", pErr.message || "No se pudo cargar productos");
    adminMeta.textContent = "Error";
    return;
  }

  const { data: sizes, error: sErr } = await supabase
    .from("product_sizes")
    .select("id,product_id,label,extra_price");

  if(sErr){
    toast("Error", sErr.message || "No se pudo cargar tallas");
  }

  PRODUCTS = products || [];
  SIZES = sizes || [];
  renderAdminList();
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

function renderAdminList(){
  const count = PRODUCTS.length;
  adminMeta.textContent = `${count} producto${count===1?"":"s"}`;
  adminEmpty.hidden = count !== 0;
  adminList.innerHTML = "";

  for(const p of PRODUCTS){
    const { raw, final } = computeFromPrice(p);
    const disc = clamp(Number(p.discount_percent||0),0,100);

    const row = document.createElement("div");
    row.className = "adminRow";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
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

    const mid = document.createElement("div");
    mid.innerHTML = `
      <h4>${escapeHtml(p.name || "Sin nombre")}</h4>
      <div class="meta">
        ${escapeHtml(p.category || "—")}
        ${p.featured ? " • <span class='badge hot'>Destacado</span>" : ""}
        ${disc>0 ? ` • <span class='badge sale'>-${disc}%</span>` : ""}
        <div style="margin-top:6px;">
          <span class="tiny muted">Desde</span>
          <b>${moneyCOP(final)}</b>
          ${disc>0 ? `<span class="strike muted">${moneyCOP(raw)}</span>` : ""}
        </div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.className = "btn btnSoft btnSm";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => openEditorForEdit(p.id));

    const del = document.createElement("button");
    del.className = "btn btnGhost btnSm";
    del.textContent = "Eliminar";
    del.addEventListener("click", async () => {
      const ok = confirm(`¿Eliminar "${p.name}"?`);
      if(!ok) return;
      if(p.image_path) await safeRemoveStorage(p.image_path);
      const { error } = await supabase.from("products").delete().eq("id", p.id);
      if(error) return toast("Error", error.message || "No se pudo eliminar");
      toast("Eliminado", "Producto borrado");
      await loadAdminData();
    });

    actions.append(edit, del);

    row.append(thumb, mid, actions);
    adminList.appendChild(row);
  }
}

// ----- Editor -----
function openEditorForNew(){
  currentEditProduct = null;
  productId.value = "";
  editorTitle.textContent = "Nuevo producto";
  deleteBtn.hidden = true;

  pName.value = "";
  pCategory.value = "manillas";
  pDesc.value = "";
  pBasePrice.value = "0";
  pDiscount.value = "0";
  pFeatured.checked = false;
  pColors.value = "";
  pSizes.value = "";

  currentImageBlob = null;
  imgPreview.style.display = "none";
  imgPreview.removeAttribute("src");
  imgInfo.textContent = "—";
  pImage.value = "";

  editor.hidden = false;
  toast("Editor", "Listo para crear");
}

function openEditorForEdit(id){
  const p = PRODUCTS.find(x => x.id === id);
  if(!p) return;

  currentEditProduct = p;
  productId.value = p.id;
  editorTitle.textContent = "Editar producto";
  deleteBtn.hidden = false;

  pName.value = p.name || "";
  pCategory.value = p.category || "manillas";
  pDesc.value = p.desc || "";
  pBasePrice.value = String(p.base_price ?? 0);
  pDiscount.value = String(p.discount_percent ?? 0);
  pFeatured.checked = !!p.featured;

  const colors = Array.isArray(p.colors) ? p.colors : [];
  pColors.value = colors.join(", ");

  const sizes = sizesFor(p.id);
  pSizes.value = sizes.map(s => `${s.label}, ${Number(s.extra_price||0)}`).join("\n");

  currentImageBlob = null;
  pImage.value = "";
  if(p.image_url){
    imgPreview.src = p.image_url;
    imgPreview.style.display = "block";
    imgInfo.textContent = "Imagen actual";
  }else{
    imgPreview.style.display = "none";
    imgInfo.textContent = "Sin imagen";
  }

  editor.hidden = false;
}

function closeEditorUI(){
  editor.hidden = true;
  currentEditProduct = null;
  currentImageBlob = null;
  pImage.value = "";
}

function parseColors(input){
  return (input || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function parseSizes(text){
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const out = [];
  for(const line of lines){
    const parts = line.split(",").map(x => x.trim());
    const label = parts[0] || "";
    const extra = Number(parts[1] || 0);
    if(!label) continue;
    out.push({ label, extra_price: Number.isNaN(extra) ? 0 : Math.max(0, Math.round(extra)) });
  }
  return out;
}

// ----- Image compression: WebP max 1200w quality ~0.75 -----
pImage.addEventListener("change", async () => {
  const file = pImage.files?.[0];
  if(!file){
    currentImageBlob = null;
    imgInfo.textContent = "—";
    imgPreview.style.display = "none";
    return;
  }

  toast("Imagen", "Optimizando…");
  try{
    const result = await compressToWebP(file, 1200, 0.75);
    currentImageBlob = result.blob;
    currentImageExt = result.ext;

    imgPreview.src = result.previewUrl;
    imgPreview.style.display = "block";

    const kb = Math.round(result.blob.size / 1024);
    imgInfo.textContent = `${result.width}×${result.height} • ${kb} KB • ${result.ext.toUpperCase()}`;

    if(kb > 300){
      toast("Tip", "Ideal < 300KB. Aún puedes guardar así.");
    }
  }catch(err){
    console.warn(err);
    currentImageBlob = null;
    imgInfo.textContent = "Compresión falló — se subirá original si guardas";
    imgPreview.src = URL.createObjectURL(file);
    imgPreview.style.display = "block";
    toast("Advertencia", "No se pudo comprimir, se usará original");
  }
});

async function compressToWebP(file, maxW=1200, quality=0.75){
  const img = await loadImage(file);
  const { width, height } = fitBox(img.width, img.height, maxW);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  ctx.drawImage(img, 0, 0, width, height);

  // WebP
  const blob = await canvasToBlob(canvas, "image/webp", quality);
  const previewUrl = URL.createObjectURL(blob);

  return { blob, previewUrl, width, height, ext: "webp" };
}

function fitBox(w,h,maxW){
  if(w <= maxW) return { width: w, height: h };
  const ratio = maxW / w;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function loadImage(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Imagen inválida"));
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob((b)=>{
      if(!b) reject(new Error("toBlob falló"));
      else resolve(b);
    }, type, quality);
  });
}

// ----- Storage helpers -----
async function uploadProductImage(blobOrFile, filename){
  // path: product-images/<yyyy>/<uuid>.<ext>
  const y = new Date().getFullYear();
  const path = `${y}/${crypto.randomUUID()}-${filename}`;

  const { data, error } = await supabase.storage
    .from("product-images")
    .upload(path, blobOrFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: blobOrFile.type || "image/webp"
    });

  if(error) throw error;

  // public URL (bucket public)
  const { data: pub } = supabase.storage.from("product-images").getPublicUrl(data.path);
  const image_url = pub?.publicUrl || null;

  return { image_path: data.path, image_url };
}

async function safeRemoveStorage(path){
  try{
    const { error } = await supabase.storage.from("product-images").remove([path]);
    if(error) console.warn("remove storage error", error);
  }catch(e){
    console.warn("remove storage exception", e);
  }
}

// ----- Save (insert/update + sizes) -----
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if(!currentIsAdmin){
    toast("Bloqueado","No eres admin");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando…";

  try{
    const id = productId.value || null;

    const payload = {
      name: (pName.value || "").trim(),
      category: (pCategory.value || "").trim(),
      desc: (pDesc.value || "").trim(),
      base_price: Math.max(0, Math.round(Number(pBasePrice.value || 0))),
      discount_percent: clamp(Math.round(Number(pDiscount.value || 0)), 0, 100),
      featured: !!pFeatured.checked,
      colors: parseColors(pColors.value),
    };

    if(!payload.name || !payload.category){
      toast("Faltan campos","Nombre y categoría");
      return;
    }

    // Imagen: si el user seleccionó una nueva, subimos
    const file = pImage.files?.[0] || null;
    let newImage = null;

    if(file){
      let toUpload = file;
      if(currentImageBlob){
        toUpload = new File([currentImageBlob], "product.webp", { type: "image/webp" });
      }else{
        toast("Advertencia","Se subirá la imagen original (sin compresión)");
      }

      // si editando y existía image_path, borramos antigua (opcional seguro)
      if(currentEditProduct?.image_path){
        await safeRemoveStorage(currentEditProduct.image_path);
      }

      newImage = await uploadProductImage(toUpload, toUpload.name || "product.webp");
      payload.image_path = newImage.image_path;
      payload.image_url = newImage.image_url;
    }

    let savedProduct = null;

    if(!id){
      const { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select()
        .single();

      if(error) throw error;
      savedProduct = data;
      toast("Creado","Producto guardado");
    }else{
      const { data, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if(error) throw error;
      savedProduct = data;
      toast("Actualizado","Cambios guardados");
    }

    // Sizes: reemplazamos por completo (simple y seguro)
    const sizeRows = parseSizes(pSizes.value);
    const finalSizes = sizeRows.length ? sizeRows : [{ label: "Única", extra_price: 0 }];

    // delete previous sizes for product
    const { error: delErr } = await supabase.from("product_sizes").delete().eq("product_id", savedProduct.id);
    if(delErr) throw delErr;

    // insert sizes
    const insertPayload = finalSizes.map(s => ({
      product_id: savedProduct.id,
      label: s.label,
      extra_price: Math.max(0, Math.round(Number(s.extra_price||0)))
    }));

    const { error: insErr } = await supabase.from("product_sizes").insert(insertPayload);
    if(insErr) throw insErr;

    closeEditorUI();
    await loadAdminData();
  }catch(err){
    console.error(err);
    toast("Error", err.message || "No se pudo guardar");
  }finally{
    saveBtn.disabled = false;
    saveBtn.textContent = "Guardar";
  }
});

// Auth state changes
supabase.auth.onAuthStateChange(async () => {
  await requireAdmin();
});

// Init
requireAdmin();
