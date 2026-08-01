/* =========================================================
   I-Chat — Friends Module
   ========================================================= */

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/** Live-subscribe to my friends list (most recently added first). */
export function listenToFriends(uid, callback) {
  const q = query(collection(db, "users", uid, "friends"), orderBy("since", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
  });
}

/** Live-subscribe to pending incoming friend requests. */
export function listenToIncomingRequests(uid, callback) {
  const q = query(
    collection(db, "friendRequests"),
    where("receiver", "==", uid),
    where("status", "==", "pending")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Live-subscribe to pending outgoing friend requests (so "Add" buttons can show "Pending"). */
export function listenToOutgoingRequests(uid, callback) {
  const q = query(
    collection(db, "friendRequests"),
    where("sender", "==", uid),
    where("status", "==", "pending")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function isFriend(uid, otherUid) {
  const snap = await getDoc(doc(db, "users", uid, "friends", otherUid));
  return snap.exists();
}

export async function isBlocked(uid, otherUid) {
  const snap = await getDoc(doc(db, "users", uid, "blocked", otherUid));
  return snap.exists();
}

/** Sends a friend request, guarding against duplicates, existing friendship, or a block. */
export async function sendFriendRequest(fromUid, toUid) {
  if (fromUid === toUid) throw new Error("You can't add yourself.");
  if (await isBlocked(toUid, fromUid) || await isBlocked(fromUid, toUid)) {
    throw new Error("You can't send a request to this user.");
  }
  if (await isFriend(fromUid, toUid)) throw new Error("You're already friends.");

  const existing = await getDocs(query(
    collection(db, "friendRequests"),
    where("sender", "==", fromUid),
    where("receiver", "==", toUid),
    where("status", "==", "pending")
  ));
  if (!existing.empty) throw new Error("Friend request already sent.");

  // If the other person already sent one to me, accept it instead of creating a duplicate.
  const reverse = await getDocs(query(
    collection(db, "friendRequests"),
    where("sender", "==", toUid),
    where("receiver", "==", fromUid),
    where("status", "==", "pending")
  ));
  if (!reverse.empty) {
    await acceptFriendRequest(reverse.docs[0].id, toUid, fromUid);
    return;
  }

  await addDoc(collection(db, "friendRequests"), {
    sender: fromUid,
    receiver: toUid,
    status: "pending",
    createdAt: serverTimestamp()
  });
}

/** Accepts a friend request — marks it accepted and creates the mutual friends-list entries. */
export async function acceptFriendRequest(requestId, senderUid, receiverUid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "friendRequests", requestId), { status: "accepted" });
  batch.set(doc(db, "users", senderUid, "friends", receiverUid), { uid: receiverUid, since: serverTimestamp() });
  batch.set(doc(db, "users", receiverUid, "friends", senderUid), { uid: senderUid, since: serverTimestamp() });
  await batch.commit();
}

export async function declineFriendRequest(requestId) {
  await updateDoc(doc(db, "friendRequests", requestId), { status: "rejected" });
}

export async function cancelFriendRequest(requestId) {
  await deleteDoc(doc(db, "friendRequests", requestId));
}

/** Removes a friendship on both sides. */
export async function removeFriend(uid, otherUid) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "friends", otherUid));
  batch.delete(doc(db, "users", otherUid, "friends", uid));
  await batch.commit();
}

/** Blocks a user: removes any friendship and marks the block one-directionally. */
export async function blockUser(uid, otherUid) {
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid, "blocked", otherUid), { blockedAt: serverTimestamp() });
  batch.delete(doc(db, "users", uid, "friends", otherUid));
  batch.delete(doc(db, "users", otherUid, "friends", uid));
  await batch.commit();
}

export async function unblockUser(uid, otherUid) {
  await deleteDoc(doc(db, "users", uid, "blocked", otherUid));
}

export function listenToBlocked(uid, callback) {
  const q = query(collection(db, "users", uid, "blocked"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
  });
}
