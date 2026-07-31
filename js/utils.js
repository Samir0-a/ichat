/* =========================================================
   I-Chat — Shared Utilities
   ========================================================= */

/** Show a toast notification. type: 'success' | 'error' | 'info' | 'warning' */
export function showToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-exclamation",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation"
  };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** Escape user-supplied text before inserting as HTML (XSS protection) */
export function escapeHTML(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Basic input sanitizer for text fields (trims + strips angle brackets) */
export function sanitizeInput(str = "") {
  return str.trim().replace(/[<>]/g, "");
}

export function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUsername(username = "") {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

/** Firestore Timestamp, Date, or millis → "HH:MM" */
export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value) {
  const date = toDate(value);
  if (!date) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatLastSeen(value) {
  const date = toDate(value);
  if (!date) return "Offline";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Active just now";
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Active ${days}d ago`;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
  return new Date(value);
}

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Deterministic 1-to-1 chat id so both participants resolve the same document */
export function generateChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

export function initTheme() {
  const saved = localStorage.getItem("ichat-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  return saved;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ichat-theme", next);
  return next;
}

/** Renders an avatar-ring element as an HTML string */
export function avatarRingHTML({ photoURL, name, online, size = 44 }) {
  const inner = photoURL
    ? `<img src="${escapeHTML(photoURL)}" alt="${escapeHTML(name)}" />`
    : `<div class="avatar-fallback" style="font-size:${size * 0.38}px">${initials(name)}</div>`;
  return `<span class="avatar-ring ${online ? "online" : "offline"}" style="width:${size}px;height:${size}px">${inner}</span>`;
}

export function friendlyAuthError(code = "") {
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user": "Sign-in popup was closed before completing.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };
  return map[code] || "Something went wrong. Please try again.";
}
