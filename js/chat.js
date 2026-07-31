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

/** Search users by username prefix (excludes the current user). */
export async function searchUsers(term, currentUid) {
  const cleaned = sanitizeInput(term).toLowerCase();
  if (!cleaned) return [];
  const q = query(
    collection(db, "users"),
    orderBy("username"),
    where("username", ">=", cleaned),
    where("username", "<=", cleaned + "\uf8ff"),
    limit(15)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).filter(u => u.uid !== currentUid);
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

  await updateDoc(chatRef, {
    lastMessage: clean,
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
