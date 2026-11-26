import {
  onAuthStateChanged, signOut, EmailAuthProvider,
  reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  doc, collection, onSnapshot, runTransaction, setDoc, updateDoc,
  addDoc, deleteDoc, serverTimestamp, query, orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

// ---------- Helper ----------
const $ = (id) => document.getElementById(id);
const rp = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
const toast = (title, icon = "success") => Swal.fire({ toast: true, position: "top", timer: 2200, showConfirmButton: false, icon, title });
const fail = (title, text) => Swal.fire({ icon: "error", title, text, confirmButtonColor: "#c0392b" });
const ask = (title, text, ok = "Ya") => Swal.fire({ title, text, icon: "question", showCancelButton: true, confirmButtonText: ok, cancelButtonText: "Batal", confirmButtonColor: "#1f7a4d" }).then((r) => r.isConfirmed);
const empty = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
const tally = (rows) => rows.reduce((m, [k, v]) => ((m[k] = (m[k] || 0) + v), m), {});

const state = { products: [], orders: [], expenses: [], account: {} };
let base = null; // dokumen toko milik pengguna: umkm_tenants/{uid}

// ---------- Filter periode ----------
function bindPeriod(modeId, valId, onChange) {
  const mode = $(modeId), val = $(valId);
  const sync = () => {
    val.hidden = mode.value === "semua";
    const type = mode.value === "bulanan" ? "month" : "date";
    if (val.type !== type) { val.type = type; val.value = ""; }
    if (!val.value) val.value = type === "month" ? today().slice(0, 7) : today();
  };
  mode.addEventListener("change", () => { sync(); onChange(); });
  val.addEventListener("change", onChange);
  sync();
}
const inPeriod = (date, modeId, valId) => {
  const m = $(modeId).value, v = $(valId).value;
  return m === "semua" || (m === "harian" ? date === v : date.startsWith(v));
};

// ---------- Navigasi ----------
function route() {
  const names = ["dashboard", "pelanggan", "stok", "pengeluaran", "laporan", "akun"];
  let v = location.hash.slice(1);
  if (!names.includes(v)) v = "dashboard";
  names.forEach((n) => ($("v-" + n).hidden = n !== v));
  document.querySelectorAll(".nav a").forEach((a) => a.removeAttribute("aria-current"));
  document.querySelectorAll(".nav a").forEach((a) => { if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------- Pesanan: form multi-menu ----------
function productOptions() {
  return '<option value="">Pilih menu</option>' + state.products.map((p) =>
    `<option value="${esc(p.id)}" ${p.stock <= 0 ? "disabled" : ""}>${esc(p.name)} - ${rp(p.price)} (stok ${p.stock})</option>`).join("");
}
function fillSelect(sel) { const keep = sel.value; sel.innerHTML = productOptions(); sel.value = keep; }
function addRow() {
  const d = document.createElement("div");
  d.className = "item-row";
  d.innerHTML = `<select class="p" required aria-label="Menu"></select><input class="q" type="number" min="1" step="1" value="1" required aria-label="Jumlah"><input class="n" placeholder="Catatan (mis. pedas)" aria-label="Catatan"><button type="button" class="ghost rm" aria-label="Hapus menu">&times;</button>`;
  $("items").append(d);
  fillSelect(d.querySelector(".p"));
}
function readItems() {
  const merged = {};
  document.querySelectorAll("#items .item-row").forEach((r) => {
    const pid = r.querySelector(".p").value, qty = parseInt(r.querySelector(".q").value, 10) || 0;
    if (!pid || qty < 1) return;
    merged[pid] = merged[pid] || { pid, qty: 0, note: "" };
    merged[pid].qty += qty; // produk sama di beberapa baris digabung
    const note = r.querySelector(".n").value.trim();
    if (note) merged[pid].note = [merged[pid].note, note].filter(Boolean).join("; ");
  });
  return Object.values(merged);
}
function calcTotal() {
  $("o-total").textContent = rp(sum(readItems(), (i) => (state.products.find((p) => p.id === i.pid)?.price || 0) * i.qty));
}
$("add-row").addEventListener("click", addRow);
$("items").addEventListener("click", (e) => {
  if (!e.target.closest(".rm")) return;
  if (document.querySelectorAll("#items .item-row").length > 1) e.target.closest(".item-row").remove();
  calcTotal();
});
$("items").addEventListener("input", calcTotal);

$("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = readItems();
  const ref = $("o-ref").value.trim(), name = $("o-name").value.trim();
  if (!ref || !name) return fail("Data belum lengkap", "Isi ID pelanggan / No. meja dan nama pemesan.");
  if (!items.length) return fail("Pilih menu", "Pilih minimal satu menu.");
  const btn = $("o-save"); btn.disabled = true;
  try {
    const orderNo = "ORD-" + Date.now().toString(36).slice(-5).toUpperCase();
    await runTransaction(db, async (tx) => {
      const refs = items.map((i) => doc(base, "products", i.pid));
      const snaps = await Promise.all(refs.map((r) => tx.get(r))); // semua baca dulu, baru tulis
      const lines = snaps.map((s, k) => {
        if (!s.exists()) throw new Error("Produk sudah dihapus.");
        const p = s.data();
        if (p.stock < items[k].qty) throw new Error(`Stok "${p.name}" tersisa ${p.stock}.`);
        return { pid: items[k].pid, name: p.name, price: p.price, qty: items[k].qty, note: items[k].note };
      });
      lines.forEach((l, k) => tx.update(refs[k], { stock: snaps[k].data().stock - l.qty }));
      tx.set(doc(collection(base, "orders")), {
        orderNo, date: $("o-date").value || today(), customerName: name, customerRef: ref.toUpperCase(),
        type: $("o-type").value, channel: $("o-channel").value, payment: $("o-pay").value,
        items: lines, total: sum(lines, (l) => l.price * l.qty), status: "Baru", createdAt: serverTimestamp(),
      });
    });
    $("order-form").reset(); $("o-date").value = today();
    $("items").innerHTML = ""; addRow(); calcTotal();
    toast(`Pesanan ${orderNo} tersimpan`);
  } catch (err) {
    fail("Pesanan gagal disimpan", err.message);
  } finally { btn.disabled = false; }
});

async function cancelOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o || !(await ask("Batalkan pesanan?", `${o.orderNo} akan dihapus dan stok dikembalikan.`, "Ya, batalkan"))) return;
  try {
    await runTransaction(db, async (tx) => {
      const pRefs = o.items.map((i) => doc(base, "products", i.pid));
      const pSnaps = await Promise.all(pRefs.map((r) => tx.get(r)));
      pSnaps.forEach((s, k) => s.exists() && tx.update(pRefs[k], { stock: s.data().stock + o.items[k].qty }));
      tx.delete(doc(base, "orders", id));
    });
    toast("Pesanan dibatalkan");
  } catch (err) { fail("Gagal membatalkan", err.message); }
}
const NEXT = { Baru: "Diproses", Diproses: "Selesai" };

// ---------- Render ----------
function renderDash() {
  const q = $("d-q").value.trim().toLowerCase(), st = $("d-status").value;
  const inRange = state.orders.filter((o) => inPeriod(o.date, "d-mode", "d-val"));
  $("s-total").textContent = inRange.length;
  ["Baru", "Diproses", "Selesai"].forEach((s, k) => ($(["s-baru", "s-proses", "s-selesai"][k]).textContent = inRange.filter((o) => o.status === s).length));
  $("s-omzet").textContent = rp(sum(inRange, (o) => o.total));
  $("s-top").textContent = top(tally(state.orders.flatMap((o) => o.items.map((i) => [i.name, i.qty]))));
  const rows = inRange.filter((o) => (!st || o.status === st) && (!q || (o.orderNo + o.customerName).toLowerCase().includes(q)));
  $("t-orders").innerHTML = rows.map((o) => `<tr>
    <td>${esc(o.orderNo)}<br><small>${esc(o.date)}</small></td>
    <td>${esc(o.customerName)}<br><small>${esc(o.customerRef)} - ${esc(o.type)}</small></td>
    <td>${o.items.map((i) => `${esc(i.name)} (${i.qty}x)${i.note ? ` <small>[${esc(i.note)}]</small>` : ""}`).join("<br>")}</td>
    <td>${esc(o.channel)}<br><small>${esc(o.payment)}</small></td>
    <td class="num">${rp(o.total)}</td><td><span class="badge b-${esc(o.status)}">${esc(o.status)}</span></td>
    <td>${NEXT[o.status] ? `<button class="mini" data-act="next" data-id="${esc(o.id)}">${NEXT[o.status]}</button>` : ""}<button class="mini del" data-act="cancel" data-id="${esc(o.id)}">Batalkan</button></td></tr>`).join("")
    || empty(7, "Belum ada pesanan pada filter ini.");
}

function customers() {
  const map = {};
  state.orders.forEach((o) => {
    const c = (map[o.customerRef] = map[o.customerRef] || { ref: o.customerRef, name: o.customerName, type: o.type, count: 0, total: 0 });
    c.count++; c.total += o.total;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}
function renderCustomers() {
  const q = $("c-q").value.trim().toLowerCase();
  const rows = customers().filter((c) => !q || (c.name + c.ref).toLowerCase().includes(q));
  $("t-cust").innerHTML = rows.map((c) => `<tr><td>${esc(c.name)}${c.count >= 2 ? ' <span class="badge b-Selesai">Loyal</span>' : ""}</td><td>${esc(c.ref)}</td><td>${esc(c.type)}</td><td class="num">${c.count}x</td><td class="num">${rp(c.total)}</td></tr>`).join("")
    || empty(5, "Belum ada pelanggan. Data muncul setelah pesanan pertama.");
}

function renderStock() {
  const q = $("p-q").value.trim().toLowerCase();
  const rows = state.products.filter((p) => !q || p.name.toLowerCase().includes(q));
  $("t-prod").innerHTML = rows.map((p) => {
    const label = p.stock <= 0 ? "Habis" : p.stock <= 5 ? "Menipis" : "Tersedia";
    return `<tr><td><small>PRD-${esc(p.id.slice(0, 4).toUpperCase())}</small></td><td>${esc(p.name)}</td><td class="num">${rp(p.price)}</td><td class="num">${p.stock}</td>
      <td><span class="badge b-${label}">${label}</span></td>
      <td><button class="mini" data-act="stock" data-id="${esc(p.id)}">Ubah stok</button><button class="mini del" data-act="delp" data-id="${esc(p.id)}">Hapus</button></td></tr>`;
  }).join("") || empty(6, "Belum ada produk. Tambahkan menu pertama Anda di atas.");
}

function expensesInRange() {
  const cat = $("e-cat").value;
  return state.expenses.filter((x) => inPeriod(x.date, "e-mode", "e-val") && (!cat || x.category === cat));
}
function renderExpenses() {
  const rows = expensesInRange();
  $("e-total").textContent = rp(sum(rows, (x) => x.amount));
  $("e-cash").textContent = rp(sum(rows.filter((x) => x.source === "Tunai"), (x) => x.amount));
  $("t-exp").innerHTML = rows.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.desc)}</td><td>${esc(x.category)}</td><td>${esc(x.source)}</td><td class="num">${rp(x.amount)}</td>
    <td><button class="mini del" data-act="delx" data-id="${esc(x.id)}">Hapus</button></td></tr>`).join("") || empty(6, "Belum ada pengeluaran pada filter ini.");
}

function reportData() {
  const orders = state.orders.filter((o) => inPeriod(o.date, "r-mode", "r-val"));
  const exps = state.expenses.filter((x) => inPeriod(x.date, "r-mode", "r-val"));
  const sales = orders.flatMap((o) => o.items.map((i) => ({ Tanggal: o.date, "No Order": o.orderNo, Produk: i.name, Qty: i.qty, Pelanggan: o.customerName, Pembayaran: o.payment, Saluran: o.channel, Total: i.price * i.qty })));
  return { orders, exps, sales };
}
function renderReport() {
  const { orders, exps, sales } = reportData();
  const omzet = sum(orders, (o) => o.total), exp = sum(exps, (x) => x.amount);
  const byPay = (p) => sum(orders.filter((o) => o.payment === p), (o) => o.total);
  $("r-omzet").textContent = rp(omzet); $("r-exp").textContent = rp(exp); $("r-profit").textContent = rp(omzet - exp);
  $("r-cash").textContent = rp(byPay("Tunai") - sum(exps.filter((x) => x.source === "Tunai"), (x) => x.amount));
  $("r-qris").textContent = rp(byPay("QRIS")); $("r-tf").textContent = rp(byPay("Transfer Bank"));
  $("r-chan").textContent = top(tally(orders.map((o) => [o.channel, 1])));
  $("r-top").textContent = top(tally(sales.map((s) => [s.Produk, s.Qty])));
  $("t-sales").innerHTML = sales.map((s) => `<tr><td>${esc(s.Tanggal)}</td><td>${esc(s.Produk)}</td><td class="num">${s.Qty}</td><td>${esc(s.Pelanggan)}<br><small>${esc(s.Pembayaran)}</small></td><td class="num">${rp(s.Total)}</td></tr>`).join("") || empty(5, "Belum ada transaksi pada periode ini.");
}
$("export").addEventListener("click", () => {
  const { orders, exps, sales } = reportData();
  const omzet = sum(orders, (o) => o.total), exp = sum(exps, (x) => x.amount);
  const wb = XLSX.utils.book_new();
  const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "Tidak ada data" }]), name);
  add(sales, "Penjualan");
  add(exps.map((x) => ({ Tanggal: x.date, Deskripsi: x.desc, Kategori: x.category, Sumber: x.source, Nominal: x.amount })), "Pengeluaran");
  add([{ Omzet: omzet, Pengeluaran: exp, "Laba bersih": omzet - exp }], "Ringkasan");
  XLSX.writeFile(wb, `laporan-${state.account.storeName || "toko"}-${today()}.xlsx`);
});

function renderAccount() {
  const a = state.account;
  $("store-title").textContent = a.storeName || "UMKM Digital";
  $("a-summary").textContent = `Data tersimpan: ${state.products.length} produk, ${customers().length} pelanggan, ${state.orders.length} transaksi.`;
  if (document.activeElement.closest("#profile-form")) return; // jangan timpa saat sedang mengetik
  $("a-store").value = a.storeName || ""; $("a-owner").value = a.ownerName || "";
  $("a-phone").value = a.phone || ""; $("a-addr").value = a.address || "";
}
const renderAll = () => { renderDash(); renderCustomers(); renderStock(); renderExpenses(); renderReport(); renderAccount(); };

// ---------- Aksi tabel ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.act === "next") { const o = state.orders.find((x) => x.id === id); await updateDoc(doc(base, "orders", id), { status: NEXT[o.status] }); }
    if (b.dataset.act === "cancel") await cancelOrder(id);
    if (b.dataset.act === "delx" && (await ask("Hapus pengeluaran?", "Data ini akan dihapus permanen.", "Hapus"))) await deleteDoc(doc(base, "expenses", id));
    if (b.dataset.act === "delp") {
      const p = state.products.find((x) => x.id === id);
      if (await ask("Hapus produk?", `"${p.name}" akan dihapus dari daftar menu.`, "Hapus")) await deleteDoc(doc(base, "products", id));
    }
    if (b.dataset.act === "stock") {
      const p = state.products.find((x) => x.id === id);
      const { value } = await Swal.fire({ title: p.name, text: "Jumlah stok terbaru", input: "number", inputValue: p.stock, inputAttributes: { min: 0, step: 1 }, showCancelButton: true, confirmButtonText: "Simpan", cancelButtonText: "Batal", confirmButtonColor: "#1f7a4d" });
      if (value === undefined || value === "") return;
      const n = parseInt(value, 10);
      if (!Number.isInteger(n) || n < 0) return fail("Stok tidak valid", "Masukkan angka 0 atau lebih.");
      await updateDoc(doc(base, "products", id), { stock: n });
      toast("Stok diperbarui");
    }
  } catch (err) { fail("Terjadi kesalahan", err.message); }
});

// ---------- Formulir ----------
$("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("p-name").value.trim(), price = Number($("p-price").value), stock = parseInt($("p-stock").value, 10);
  if (!name || !(price >= 0) || !Number.isInteger(stock) || stock < 0) return fail("Data belum valid", "Periksa nama, harga, dan stok.");
  if (state.products.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail("Produk sudah ada", "Gunakan nama lain atau ubah stok produk yang ada.");
  try { await addDoc(collection(base, "products"), { name, price, stock, createdAt: serverTimestamp() }); e.target.reset(); toast("Produk ditambahkan"); }
  catch (err) { fail("Gagal menambah produk", err.message); }
});
$("exp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number($("x-amt").value);
  if (!(amount > 0)) return fail("Nominal tidak valid", "Masukkan nominal lebih dari 0.");
  try {
    await addDoc(collection(base, "expenses"), { date: $("x-date").value || today(), desc: $("x-desc").value.trim(), category: $("x-cat").value, source: $("x-src").value, amount, createdAt: serverTimestamp() });
    e.target.reset(); $("x-date").value = today(); toast("Pengeluaran tersimpan");
  } catch (err) { fail("Gagal menyimpan", err.message); }
});
$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await setDoc(base, { account: { ...state.account, storeName: $("a-store").value.trim(), ownerName: $("a-owner").value.trim(), phone: $("a-phone").value.trim(), address: $("a-addr").value.trim() } }, { merge: true });
    toast("Profil disimpan");
  } catch (err) { fail("Gagal menyimpan profil", err.message); }
});
$("pass-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const oldP = $("a-old").value, newP = $("a-new").value;
  if (newP.length < 8) return fail("Password terlalu pendek", "Minimal 8 karakter.");
  if (newP !== $("a-new2").value) return fail("Konfirmasi tidak sama", "Ulangi password baru dengan benar.");
  if (newP === oldP) return fail("Password sama", "Password baru harus berbeda.");
  try {
    const u = auth.currentUser;
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldP));
    await updatePassword(u, newP);
    e.target.reset(); $("a-email").value = u.email; toast("Password diperbarui");
  } catch (err) {
    const wrong = ["auth/invalid-credential", "auth/wrong-password"].includes(err.code);
    fail(wrong ? "Password lama salah" : "Gagal memperbarui password", wrong ? "Periksa kembali password lama Anda." : err.message);
  }
});
$("logout").addEventListener("click", async () => {
  if (await ask("Keluar dari akun?", "Anda akan kembali ke halaman masuk.", "Keluar")) signOut(auth).then(() => location.replace("index.html"));
});

// ---------- Filter & pencarian ----------
bindPeriod("d-mode", "d-val", renderDash);
bindPeriod("e-mode", "e-val", renderExpenses);
bindPeriod("r-mode", "r-val", renderReport);
["d-q", "d-status"].forEach((id) => $(id).addEventListener("input", renderDash));
$("c-q").addEventListener("input", renderCustomers);
$("p-q").addEventListener("input", renderStock);
$("e-cat").addEventListener("change", renderExpenses);
$("o-date").value = $("x-date").value = today();
addRow();

// ---------- Mulai setelah login terverifikasi ----------
onAuthStateChanged(auth, (user) => {
  if (!user) return location.replace("index.html");
  base = doc(db, "umkm_tenants", user.uid);
  $("a-email").value = user.email;
  const listen = (col, key, order) => onSnapshot(query(collection(base, col), orderBy(order, "desc")), (snap) => {
    state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (key === "products") document.querySelectorAll("#items .p").forEach(fillSelect);
    renderAll(); calcTotal();
  }, (err) => fail("Gagal memuat data", err.message));
  onSnapshot(base, (s) => { state.account = s.data()?.account || {}; renderAccount(); });
  listen("products", "products", "createdAt");
  listen("orders", "orders", "createdAt");
  listen("expenses", "expenses", "date");
  route();
});
