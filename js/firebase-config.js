/* =========================================================
   I-Chat — Firebase Configuration
   Replace the values below with YOUR Firebase project's config.
   Firebase Console → Project Settings → General → Your apps → SDK setup
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBsVrv1l_hnw_cQYGvSnjqsj9WjXnQb6sc",
  authDomain: "chat-22665.firebaseapp.com",
  projectId: "chat-22665",
  storageBucket: "chat-22665.firebasestorage.app",
  messagingSenderId: "103675968432",
  appId: "1:103675968432:web:d3cb25b0f8ce25c931f475",
  measurementId: "G-JTF5RVET8N"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore with offline persistence enabled (multi-tab safe cache)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({})
});

export const googleProvider = new GoogleAuthProvider();
