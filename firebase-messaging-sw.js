/* firebase-messaging-sw.js (robust for data-only web FCM)
   - Shows: fromName + optional note + LOCAL time timestamp
   - Replaces notifications via tag (no stacking)
   - Handles BOTH:
       (A) Firebase onBackgroundMessage (when it fires)
       (B) Raw "push" event fallback (when it doesn't)
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

function pickData(obj) {
  // Try many shapes (FCM / Firebase SDK / raw push)
  if (!obj) return {};
  return (
    obj.data ||
    obj.message?.data ||
    obj.message?.notification?.data ||
    obj.notification?.data ||
    {}
  );
}

async function showCallNotificationFromData(data) {
  data = data || {};

  const callId   = String(data.callId || "");
  if (!callId) return; // not a call

  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL TIME (use server-provided ms if present)
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // single line works best across OSes
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  // Replace instead of stacking
  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  const options = {
    body,
    tag,
    renotify: false,
    requireInteraction: true,
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
  };

  await self.registration.showNotification(title, options);
}

/* (A) Firebase SDK handler */
messaging.onBackgroundMessage((payload) => {
  try {
    const data = pickData(payload);
    showCallNotificationFromData(data);
  } catch {
    // ignore
  }
});

/* (B) Raw push fallback handler */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = null;

    // Try JSON
    try { payload = event.data?.json?.(); } catch {}

    // Fallback: text -> JSON
    if (!payload) {
      try {
        const txt = event.data?.text ? await event.data.text() : "";
        payload = txt ? JSON.parse(txt) : null;
      } catch {}
    }

    if (!payload) return;

    const data = pickData(payload);
    await showCallNotificationFromData(data);
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
