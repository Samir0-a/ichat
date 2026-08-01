/* =========================================================
   I-Chat — Authentication Module
   ========================================================= */

import { auth, db, googleProvider } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { isValidEmail, isValidUsername, sanitizeInput } from "./utils.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

/** Checks the public `usernames` lookup collection to see if a username is already taken. */
export async function isUsernameTaken(username) {
  const snap = await getDoc(doc(db, "usernames", username.toLowerCase()));
  return snap.exists();
}

/**
 * Registers a new user: creates the Firebase Auth account, optionally uploads
 * a profile picture to Storage, writes the user's profile doc to Firestore,
 * and sends an email verification link.
 */
export async function registerUser({ fullName, username, email, password, confirmPassword, photoFile }) {
  fullName = sanitizeInput(fullName);
  username = sanitizeInput(username).toLowerCase();
  email = email.trim();

  if (!fullName || fullName.length < 2) throw new Error("Please enter your full name.");
  if (!isValidUsername(username)) throw new Error("Username must be 3-20 characters (letters, numbers, underscore).");
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (password !== confirmPassword) throw new Error("Passwords do not match.");
  if (await isUsernameTaken(username)) throw new Error("That username is already taken.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const user = cred.user;

  let photoURL = "";
  if (photoFile) {
    try {
      photoURL = await uploadToCloudinary(photoFile, "profile-pictures");
    } catch (err) {
      // Don't block account creation over a failed avatar upload
      console.error(err);
    }
  }

  await updateProfile(user, { displayName: fullName, photoURL: photoURL || null });

  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name: fullName,
    username,
    email,
    profileImage: photoURL,
    status: "Hey there! I'm using I-Chat.",
    online: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
    themePreference: "dark"
  });

  await setDoc(doc(db, "usernames", username), { uid: user.uid });

  await sendEmailVerification(user);

  return user;
}

/** Logs in with email + password. `remember` controls session persistence. */
export async function loginUser({ email, password, remember }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  await markOnline(cred.user.uid);
  return cred.user;
}

/** Signs in (or registers, on first use) via Google popup. */
export async function loginWithGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const cred = await signInWithPopup(auth, googleProvider);
  const user = cred.user;

  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);
  if (!existing.exists()) {
    const baseUsername = (user.email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "");
    let username = baseUsername;
    let n = 0;
    while (await isUsernameTaken(username)) {
      n += 1;
      username = `${baseUsername}${n}`;
    }
    await setDoc(userRef, {
      uid: user.uid,
      name: user.displayName || "New User",
      username,
      email: user.email,
      profileImage: user.photoURL || "",
      status: "Hey there! I'm using I-Chat.",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      themePreference: "dark"
    });
    await setDoc(doc(db, "usernames", username), { uid: user.uid });
  } else {
    await markOnline(user.uid);
  }
  return user;
}

export async function sendResetEmail(email) {
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logoutUser() {
  if (auth.currentUser) await markOffline(auth.currentUser.uid);
  await signOut(auth);
}

export async function markOnline(uid) {
  try {
    await setDoc(doc(db, "users", uid), { online: true, lastSeen: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn("markOnline failed:", err.message);
  }
}

export async function markOffline(uid) {
  try {
    await setDoc(doc(db, "users", uid), { online: false, lastSeen: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn("markOffline failed:", err.message);
  }
}

/** Keeps the user's `online`/`lastSeen` fields accurate while a tab is open. */
export function attachPresenceHandlers(uid) {
  const goOnline = () => markOnline(uid);
  const goOffline = () => markOffline(uid);

  goOnline();
  document.addEventListener("visibilitychange", () => {
    document.hidden ? goOffline() : goOnline();
  });
  window.addEventListener("beforeunload", goOffline);
  // Heartbeat so `lastSeen` stays fresh for users who leave the tab open & idle
  setInterval(() => { if (!document.hidden) goOnline(); }, 60000);
}

/** Call on protected pages (dashboard, profile, settings). Redirects to login if signed out. */
export function requireAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    attachPresenceHandlers(user.uid);
    onReady(user);
  });
}

/** Call on login/register pages. Redirects to dashboard if already signed in. */
export function redirectIfAuthed() {
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = "dashboard.html";
  });
}

export { onAuthStateChanged, auth };
