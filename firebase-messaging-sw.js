/* firebase-messaging-sw.js (stable SW version)
   Implements:
   - Option 1: show notification ONLY for the newest ringing call for this toUid
   - Option 2: use notification tag to REPLACE instead of stacking
*/

importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore-compat.js");

firebase.initializeApp({
  apiKey:"AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain:"easosunov-webrtc.firebaseapp.com",
  projectId:"easosunov-webrtc",
  storageBucket:"easosunov-webrtc.firebasestorage.app",
  messagingSenderId:"100169991412",
  appId:"1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const messaging = firebase.messaging(); // ok to keep even if we don't use onBackgroundMessage
const db = firebase.firestore();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Returns the newest "ringing" callId for a given toUid, or null if none.
 * If the query fails (missing index / offline / etc), returns "__unknown__" (fail-open signal).
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
    // fail-open signal: can't check newest (index/security/offline/etc)
    return "__unknown__";
  }
}

/**
 * Show a call notification, but REPLACE existing via tag (Option 2).
 */
async function showCallNotification({ data }) {
  data = data || {};

  const callId   = data.callId || "";
  const toUid    = data.toUid  || "";
  const roomId   = data.roomId || "";
  const fromName = data.fromName || "Unknown";
  const toName   = data.toName   || "";

  const note = String(data.note || "").trim();

  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = data.title || "Incoming call";

  // Single-line body (better cross-platform)
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  const options = {
    body,
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
    requireInteraction: true,
    tag,
    renotify: false
  };

  await self.registration.showNotification(title, options);
}

/**
 * MAIN push handler (works for data-only messages)
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = null;

    // Try JSON first
    try { payload = event.data?.json?.(); } catch {}

    // Fallback: text -> JSON
    if (!payload) {
      try {
        const txt = event.data?.text ? await event.data.text() : "";
        payload = txt ? JSON.parse(txt) : null;
      } catch {}
    }

    if (!payload) return;

    // Support multiple possible shapes
    const data =
      payload?.data ||
      payload?.message?.data ||
      payload?.message?.notification?.data ||
      {};

    const callId = data.callId || null;
    const toUid  = data.toUid  || null;

    if (!callId) return;

    // Option 1: only newest ringing call (but fail-open if we can't query)
    if (toUid) {
      const newest = await getNewestRingingCallIdFor(toUid);

      if (newest === "__unknown__") {
        await showCallNotification({ data });
        return;
      }

      if (!newest) return;
      if (newest !== callId) return;
    }

    await showCallNotification({ data });
  })());
});

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
