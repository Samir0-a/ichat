/* =========================================================
   I-Chat — Real-Time Chat Module
   ========================================================= */

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { generateChatId, sanitizeInput } from "./utils.js";

/** Fetch a single user's profile document. */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/** Live-subscribe to a user's document (name, status, online, lastSeen...). */
export function listenToUser(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

/** Search users by username, display name, or email (excludes the current user). */
export async function searchUsers(term, currentUid) {
  let cleaned = sanitizeInput(term).trim();
  if (cleaned.startsWith("@")) cleaned = cleaned.slice(1);
  cleaned = cleaned.toLowerCase();
  if (!cleaned) return [];

  console.log(`[searchUsers] Searching for: "${cleaned}" (currentUid: ${currentUid})`);
  const results = new Map();
  const titleCaseTerm = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  try {
    const queries = [
      // 1. Username prefix search
      { label: "username", q: query(collection(db, "users"), where("username", ">=", cleaned), where("username", "<=", cleaned + "\uf8ff"), limit(15)) },
      // 2. Normalized lowercased name search
      { label: "nameLower", q: query(collection(db, "users"), where("nameLower", ">=", cleaned), where("nameLower", "<=", cleaned + "\uf8ff"), limit(15)) },
      // 3. Title-case display name search (legacy fallback)
      { label: "nameTitleCase", q: query(collection(db, "users"), where("name", ">=", titleCaseTerm), where("name", "<=", titleCaseTerm + "\uf8ff"), limit(15)) },
      // 4. Email prefix search
      { label: "email", q: query(collection(db, "users"), where("email", ">=", cleaned), where("email", "<=", cleaned + "\uf8ff"), limit(15)) }
    ];

    const snapshots = await Promise.allSettled(queries.map(item => getDocs(item.q)));

    snapshots.forEach((res, idx) => {
      const label = queries[idx].label;
      if (res.status === "fulfilled" && res.value) {
        console.log(`[searchUsers] Query "${label}" matched ${res.value.docs.length} docs`);
        res.value.docs.forEach(d => {
          const data = d.data();
          const targetUid = data.uid || d.id;
          if (targetUid && (!currentUid || targetUid !== currentUid)) {
            data.uid = targetUid;
            data.name = data.name || data.username || `User ${targetUid.slice(0, 4)}`;
            data.username = data.username || `user_${targetUid.slice(0, 4)}`;
            results.set(targetUid, data);
          }
        });
      } else if (res.status === "rejected") {
        console.warn(`[searchUsers] Query "${label}" failed:`, res.reason);
      }
    });
  } catch (err) {
    console.error("[searchUsers] Unexpected error executing queries:", err);
  }

  // Client-side fallback: if indexed prefix queries return no results, fetch recent users and filter
  if (results.size === 0) {
    console.log("[searchUsers] Indexed queries returned 0 results. Running fallback user scan...");
    try {
      const fallbackSnap = await getDocs(query(collection(db, "users"), limit(50)));
      console.log(`[searchUsers] Fallback scan fetched ${fallbackSnap.docs.length} total user docs from Firestore`);
      fallbackSnap.docs.forEach(d => {
        const data = d.data();
        const targetUid = data.uid || d.id;
        if (!targetUid || (currentUid && targetUid === currentUid)) return;
        
        data.uid = targetUid;
        data.name = data.name || data.username || `User ${targetUid.slice(0, 4)}`;
        data.username = data.username || `user_${targetUid.slice(0, 4)}`;
        data.email = data.email || "";

        const uName = data.name.toLowerCase();
        const uUser = data.username.toLowerCase();
        const uEmail = data.email.toLowerCase();
        
        if (uName.includes(cleaned) || uUser.includes(cleaned) || uEmail.includes(cleaned) || cleaned === "user" || cleaned === "all") {
          results.set(targetUid, data);
        }
      });
    } catch (fallbackErr) {
      console.error("[searchUsers] Fallback search failed (check Firestore Security Rules):", fallbackErr);
      throw fallbackErr;
    }
  }

  console.log(`[searchUsers] Returning ${results.size} final matching users.`);
  return Array.from(results.values()).slice(0, 15);
}

/** Live-subscribe to the current user's chat list, most recently updated first. */
export function listenToChatList(uid, callback) {
  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", uid),
    orderBy("updatedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Gets (or lazily creates) the 1-on-1 chat document between two users. */
export async function startOrGetChat(uidA, uidB) {
  const chatId = generateChatId(uidA, uidB);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      chatId,
      participants: [uidA, uidB],
      lastMessage: "",
      lastMessageSender: "",
      updatedAt: serverTimestamp(),
      typing: {},
      unread: { [uidA]: 0, [uidB]: 0 }
    });
  }
  return chatId;
}

export function getOtherParticipant(chat, myUid) {
  return chat.participants.find(p => p !== myUid);
}

/** Live-subscribe to a chat's messages, oldest first. */
export function listenToMessages(chatId, callback) {
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Sends a text message and updates the parent chat's preview/unread counters. */
export async function sendMessage(chatId, senderId, receiverId, text, replyTo = null, type = "text") {
  const clean = text.trim();
  if (!clean) return;

  const messagesRef = collection(db, "chats", chatId, "messages");
  await addDoc(messagesRef, {
    senderId,
    receiverId,
    message: clean,
    type,
    timestamp: serverTimestamp(),
    read: false,
    delivered: true,
    edited: false,
    replyTo: replyTo || null,
    reactions: {}
  });

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  const currentUnread = chatSnap.exists() ? (chatSnap.data().unread || {}) : {};

  const preview = type === "image" ? "📷 Photo" : clean;

  await updateDoc(chatRef, {
    lastMessage: preview,
    lastMessageSender: senderId,
    updatedAt: serverTimestamp(),
    [`unread.${receiverId}`]: (currentUnread[receiverId] || 0) + 1,
    [`unread.${senderId}`]: 0,
    [`typing.${senderId}`]: false
  });
}

export async function editMessage(chatId, messageId, newText) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    message: newText.trim(),
    edited: true
  });
}

export async function deleteMessageForEveryone(chatId, messageId) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    message: "This message was deleted",
    type: "deleted",
    reactions: {}
  });
}

export async function toggleReaction(chatId, messageId, uid, emoji) {
  const msgRef = doc(db, "chats", chatId, "messages", messageId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;
  const reactions = snap.data().reactions || {};
  if (reactions[uid] === emoji) {
    delete reactions[uid];
  } else {
    reactions[uid] = emoji;
  }
  await updateDoc(msgRef, { reactions });
}

/** Marks all of the other participant's messages as read (blue tick receipts). */
export async function markMessagesRead(chatId, myUid) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    where("receiverId", "==", myUid),
    where("read", "==", false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  batch.update(doc(db, "chats", chatId), { [`unread.${myUid}`]: 0 });
  await batch.commit();
}

/** Sets/clears the "typing…" flag for a user inside a chat document. */
export async function setTypingStatus(chatId, uid, isTyping) {
  try {
    await updateDoc(doc(db, "chats", chatId), { [`typing.${uid}`]: isTyping });
  } catch { /* chat may not exist yet — safe to ignore */ }
}