/* firebase-messaging-sw.js (stable SW version)
   Implements:
   - Option 1: show notification ONLY for the newest ringing call for this toUid (fail-open if query can't be done)
   - Option 2: use notification tag to REPLACE instead of stacking
   - Shows caller message (note) + LOCAL TIME timestamp (sentAtMs) in notification body
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

const messaging = firebase.messaging();
const db = firebase.firestore();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
  } catch {
    // fail-open if we can't query (missing index/rules/offline)
    return "__unknown__";
  }
}

async function showCallNotification(payload) {
  const data = payload?.data || {};

  const callId   = String(data.callId || "");
  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL TIME from caller/server ms
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single line is most reliable cross-platform
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
    renotify: false
  };

  await self.registration.showNotification(title, options);
}

/**
 * MAIN: Firebase background message handler
 * Works reliably with Firebase Messaging on web.
 */
messaging.onBackgroundMessage((payload) => {
  eventWaitUntil(async () => {
    const data = payload?.data || {};
    const callId = data.callId || null;
    const toUid  = data.toUid  || null;

    if (!callId) return;

    // Option 1: only newest ringing call
    if (toUid) {
      const newest = await getNewestRingingCallIdFor(toUid);

      // fail-open if we can't check
      if (newest !== "__unknown__") {
        if (!newest) return;
        if (newest !== callId) return;
      }
    }

    await showCallNotification(payload);
  });
});

function eventWaitUntil(fn) {
  try {
    return Promise.resolve().then(fn);
  } catch {
    return Promise.resolve();
  }
}

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
