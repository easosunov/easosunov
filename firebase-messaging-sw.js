/* firebase-messaging-sw.js (stable)
   - Uses notification tag to REPLACE instead of stacking
   - Shows note + LOCAL time timestamp
   - No Firestore "newest ringing" query (prevents accidental drop)
*/

importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:"AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain:"easosunov-webrtc.firebaseapp.com",
  projectId:"easosunov-webrtc",
  storageBucket:"easosunov-webrtc.firebasestorage.app",
  messagingSenderId:"100169991412",
  appId:"1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function showCallNotification(payload) {
  const data = payload?.data || {};

  const callId   = String(data.callId || "");
  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL TIME (from server-supplied ms; fallback now)
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single-line body is most reliable
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  // Replace instead of stacking (per user if possible)
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

messaging.onBackgroundMessage((payload) => {
  // DATA-ONLY push => payload.notification is empty; payload.data is what we use
  const data = payload?.data || {};
  if (!data.callId) return;
  showCallNotification(payload);
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
