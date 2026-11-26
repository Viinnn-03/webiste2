// Satu-satunya tempat konfigurasi Firebase. Dipakai oleh auth.js dan script.js.
// Catatan: config ini memang publik. Yang melindungi data adalah
// Firebase Authentication + Firestore Security Rules (lihat firestore.rules).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA3x9grxeVu_a1_BFY_1EfEtwA-rGE7LFA",
  authDomain: "manajemen-operasional-umkm.firebaseapp.com",
  projectId: "manajemen-operasional-umkm",
  storageBucket: "manajemen-operasional-umkm.firebasestorage.app",
  messagingSenderId: "139605713066",
  appId: "1:139605713066:web:610a6cc1cb5ba1fd0fb0d3",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
