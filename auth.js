import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const DASHBOARD_URL = "app.html";
const MIN_PASSWORD_LENGTH = 8;
let isRegistering = false; // mencegah redirect sebelum data toko selesai dibuat

// ---------- Helper ----------
const AUTH_ERRORS = {
  "auth/invalid-credential": "Email atau password salah.",
  "auth/wrong-password": "Email atau password salah.",
  "auth/user-not-found": "Email atau password salah.",
  "auth/invalid-email": "Format email tidak valid.",
  "auth/email-already-in-use": "Email ini sudah terdaftar. Silakan masuk.",
  "auth/weak-password": `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`,
  "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
  "auth/network-request-failed": "Koneksi internet bermasalah. Periksa jaringan Anda.",
};
const errorText = (e) => AUTH_ERRORS[e.code] || "Terjadi kesalahan. Silakan coba lagi.";

function showError(title, text) {
  return Swal.fire({ icon: "error", title, text, confirmButtonColor: "#ef4444" });
}

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("62") ? "0" + digits.slice(2) : digits;
}
const isValidPhone = (p) => /^08\d{8,12}$/.test(p);

async function withBusyButton(btn, busyText, task) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------- Tampilan ----------
function showForm(mode) {
  $("login-box").hidden = mode !== "login";
  $("register-box").hidden = mode !== "register";
  (mode === "login" ? $("login-email") : $("reg-store-name")).focus();
}
document.querySelectorAll("[data-show]").forEach((btn) =>
  btn.addEventListener("click", () => showForm(btn.dataset.show)),
);
document.querySelectorAll(".toggle-pass").forEach((btn) =>
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.target);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Sembunyikan" : "Tampilkan";
    btn.setAttribute("aria-pressed", String(show));
  }),
);

// ---------- Sudah masuk? langsung ke dashboard ----------
onAuthStateChanged(auth, (user) => {
  if (user && !isRegistering) window.location.replace(DASHBOARD_URL);
});

// ---------- Masuk ----------
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) return showError("Data belum lengkap", "Isi email dan password.");

  await withBusyButton($("btn-login"), "Memeriksa...", async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // redirect ditangani onAuthStateChanged
    } catch (err) {
      await showError("Gagal masuk", errorText(err));
    }
  });
});

// ---------- Daftar ----------
$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const storeName = $("reg-store-name").value.trim();
  const ownerName = $("reg-owner-name").value.trim();
  const phone = normalizePhone($("reg-phone").value);
  const email = $("reg-email").value.trim();
  const password = $("reg-password").value;
  const confirm = $("reg-confirm-password").value;

  if (!storeName || !ownerName || !email) return showError("Data belum lengkap", "Lengkapi semua kolom.");
  if (!isValidPhone(phone)) return showError("Nomor WhatsApp tidak valid", "Gunakan format 08xxxxxxxxxx.");
  if (password.length < MIN_PASSWORD_LENGTH) return showError("Password terlalu pendek", `Minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  if (password !== confirm) return showError("Password tidak sama", "Pastikan kedua password identik.");

  await withBusyButton($("btn-register"), "Membuat akun...", async () => {
    isRegistering = true;
    let user = null;
    try {
      ({ user } = await createUserWithEmailAndPassword(auth, email, password));
      await setDoc(doc(db, "umkm_tenants", user.uid), {
        account: { storeName, ownerName, phone, email, address: "" },
      });
      window.location.replace(DASHBOARD_URL);
    } catch (err) {
      if (user) await user.delete().catch(() => {}); // batalkan akun setengah jadi
      isRegistering = false;
      await showError("Gagal mendaftar", errorText(err));
    }
  });
});

// ---------- Lupa password (tautan reset dikirim ke email) ----------
$("btn-forgot").addEventListener("click", async () => {
  const { value: email } = await Swal.fire({
    title: "Reset password",
    text: "Kami akan mengirim tautan reset ke email Anda.",
    input: "email",
    inputValue: $("login-email").value.trim(),
    inputLabel: "Email akun",
    showCancelButton: true,
    confirmButtonText: "Kirim tautan",
    cancelButtonText: "Batal",
    confirmButtonColor: "#059669",
  });
  if (!email) return;

  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") return showError("Gagal mengirim", errorText(err));
  }
  // Pesan sengaja sama, supaya orang lain tidak bisa mengecek email mana yang terdaftar.
  Swal.fire({
    icon: "success",
    title: "Periksa email Anda",
    text: "Jika email terdaftar, tautan reset password sudah dikirim. Cek juga folder spam.",
    confirmButtonColor: "#059669",
  });
});
