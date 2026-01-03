/* firebase-messaging-sw.js (stable SW version)
   Implements:
   - Option 1: show notification ONLY for the newest ringing call for this toUid (fail-open if query can't be done)
   - Option 2: use notification tag to REPLACE instead of stacking
   - Shows caller message (note) + LOCAL TIME timestamp (sentAtMs) in notification body
   IMPORTANT:
   - This file is for Firebase v9 compat SW (importScripts).
   - Works with DATA-ONLY FCM pushes (no top-level "notification" in the message).
*/

importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain: "easosunov-webrtc.firebaseapp.com",
  projectId: "easosunov-webrtc",
  storageBucket: "easosunov-webrtc.firebasestorage.app",
  messagingSenderId: "100169991412",
  appId: "1:100169991412:web:27ef6820f9a59add6b4aa1",
});

const db = firebase.firestore();

// Keep messaging init (not strictly required when using "push" handler, but harmless)
firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Returns the newest "ringing" callId for a given toUid, or null if none.
 * If the query fails (missing index / blocked by rules / offline), returns "__unknown__" (fail-open signal).
 */
async function getNewestRingingCallIdFor(toUid) {
  try {
    if (!toUid) return null;

    const snap = await db
      .collection("calls")
      .where("toUid", "==", toUid)
      .where("status", "==", "ringing")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) return null;
    return snap.docs[0].id;
  } catch (e) {
    // fail-open signal (we can't verify newest)
    return "__unknown__";
  }
}

/**
 * Show a call notification, but REPLACE existing via tag (Option 2).
 * Expects data-only fields:
 * { callId, toUid, roomId, fromName, toName, note, sentAtMs, title }
 */
async function showCallNotification(data) {
  data = data || {};

  const callId = String(data.callId || "");
  const toUid = String(data.toUid || "");
  const roomId = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName = String(data.toName || "");
  const note = String(data.note || "").trim();

  // LOCAL TIME timestamp (from caller/server)
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single line (most reliable across platforms)
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  // Option 2: replace instead of stacking
  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  const options = {
    body,
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
    requireInteraction: true,
    tag,
    renotify: false,
  };

  await self.registration.showNotification(title, options);
}

/**
 * Parse push event payload robustly.
 * Works with common shapes:
 *  - { data: {...} }
 *  - { message: { data: {...} } }
 *  - { message: { notification: { data: {...} } } }
 */
async function parsePushEventData(event) {
  if (!event || !event.data) return null;

  // Try JSON first (await!)
  try {
    if (typeof event.data.json === "function") {
      const payload = await event.data.json();
      const data =
        payload?.data ||
        payload?.message?.data ||
        payload?.message?.notification?.data ||
        null;
      if (data) return data;
    }
  } catch {}

  // Fallback: text -> JSON
  try {
    if (typeof event.data.text === "function") {
      const txt = await event.data.text();
      if (!txt) return null;
      const payload = JSON.parse(txt);
      const data =
        payload?.data ||
        payload?.message?.data ||
        payload?.message?.notification?.data ||
        null;
      if (data) return data;
    }
  } catch {}

  return null;
}

/**
 * MAIN push handler (works for data-only messages).
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const data = await parsePushEventData(event);
    if (!data) return;

    const callId = data.callId || null;
    const toUid = data.toUid || null;
    if (!callId) return; // Not a call push

    // Option 1: only notify for newest ringing call (fail-open if can't check)
    if (toUid) {
      const newest = await getNewestRingingCallIdFor(toUid);

      // fail-open: still show if we can't query Firestore
      if (newest !== "__unknown__") {
        if (!newest) return; // no ringing calls anymore
        if (newest !== callId) return; // not the newest -> ignore
      }
    }

    await showCallNotification(data);
  })());
});

/**
 * Open the web app on notification click.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const d = event.notification.data || {};
  const url = new URL("/easosunov/webrtc.html", self.location.origin);

  if (d.callId) url.searchParams.set("callId", d.callId);
  if (d.roomId) url.searchParams.set("roomId", d.roomId);
  if (d.fromName) url.searchParams.set("fromName", d.fromName);
  if (d.toName) url.searchParams.set("toName", d.toName);
  if (d.note) url.searchParams.set("note", d.note);

  event.waitUntil(self.clients.openWindow(url.toString()));
});
