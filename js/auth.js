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

  await step("check username availability", () => isUsernameTakenOrThrow(username));

  const cred = await step("create auth account", () => createUserWithEmailAndPassword(auth, email, password));
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

  await step("update auth profile", () => updateProfile(user, { displayName: fullName, photoURL: photoURL || null }));

  await step("write users/{uid} profile doc", () => setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name: fullName,
    nameLower: fullName.toLowerCase(),
    username,
    email,
    profileImage: photoURL,
    status: "Hey there! I'm using I-Chat.",
    online: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
    themePreference: "dark"
  }));

  await step("reserve usernames/{username} doc", () => setDoc(doc(db, "usernames", username), { uid: user.uid }));

  await step("send verification email", () => sendEmailVerification(user));

  return user;
}

/** Runs a labeled async step; on failure, tags the error with the step name and re-throws. */
async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Registration failed at step: "${label}" —`, err.code || err.message, err);
    err.stepLabel = label;
    throw err;
  }
}

async function isUsernameTakenOrThrow(username) {
  if (await isUsernameTaken(username)) throw new Error("That username is already taken.");
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
    const displayName = user.displayName || "New User";
    await setDoc(userRef, {
      uid: user.uid,
      name: displayName,
      nameLower: displayName.toLowerCase(),
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

/** Ensures that an existing user's document in Firestore has name, nameLower, username, and email fields. */
export async function ensureUserProfile(user) {
  if (!user || !user.uid) return;
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      // Do NOT auto-create a document when snap doesn't exist yet,
      // as registerUser() or loginWithGoogle() is currently building it.
      return;
    }
    const data = snap.data();
    const updates = {};
    
    if (user.displayName && (!data.name || data.name === (user.email ? user.email.split("@")[0] : "") || data.name.startsWith("User "))) {
      updates.name = user.displayName;
      updates.nameLower = user.displayName.toLowerCase();
    } else if (!data.name) {
      const fallbackName = user.displayName || (user.email ? user.email.split("@")[0] : "User");
      updates.name = fallbackName;
      updates.nameLower = fallbackName.toLowerCase();
    } else if (!data.nameLower) {
      updates.nameLower = data.name.toLowerCase();
    }

    if (!data.username) {
      const fallbackUsername = (user.email ? user.email.split("@")[0] : `user_${user.uid.slice(0, 5)}`).toLowerCase().replace(/[^a-z0-9_]/g, "");
      updates.username = fallbackUsername;
      await setDoc(doc(db, "usernames", fallbackUsername), { uid: user.uid }, { merge: true });
    }

    if (!data.email && user.email) {
      updates.email = user.email;
    }

    if (Object.keys(updates).length > 0) {
      await setDoc(userRef, updates, { merge: true });
      console.log(`[ensureUserProfile] Repaired missing fields for ${user.uid}:`, updates);
    }
  } catch (err) {
    console.warn("[ensureUserProfile] Repair warning:", err.message);
  }
}

/** Updates user profile (name, username, status, profileImage). */
export async function updateUserProfile(uid, { name, username, status, profileImage }) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  const current = snap.exists() ? snap.data() : {};
  
  const updates = {};
  if (name !== undefined) {
    updates.name = sanitizeInput(name);
    updates.nameLower = updates.name.toLowerCase();
  }
  if (username !== undefined) {
    const cleanUser = sanitizeInput(username).toLowerCase();
    if (cleanUser !== current.username) {
      if (await isUsernameTaken(cleanUser)) throw new Error("That username is already taken.");
      updates.username = cleanUser;
      await setDoc(doc(db, "usernames", cleanUser), { uid });
    }
  }
  if (status !== undefined) updates.status = sanitizeInput(status);
  if (profileImage !== undefined) updates.profileImage = profileImage;

  if (Object.keys(updates).length > 0) {
    await updateDoc(userRef, updates);
  }
}

/** Call on protected pages (dashboard, profile, settings). Redirects to login if signed out. */
export function requireAuth(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    await ensureUserProfile(user);
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