/* firebase-messaging-sw.js (DEBUG + WORKING)
   - Always shows notification for call pushes (no Firestore query)
   - Includes note + LOCAL timestamp
   - Adds a debug notification when ANY push arrives (helps diagnose “no notifications”)
   - Replaces instead of stacking using tag
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

function extractData(payload) {
  return (
    payload?.data ||
    payload?.message?.data ||
    payload?.notification?.data ||
    {}
  );
}

async function showCallNotification(data) {
  data = data || {};

  const callId = String(data.callId || "");
  if (!callId) return; // ignore non-call pushes

  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL time
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: false,
    requireInteraction: true,
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
  });
}

/**
 * 1) RAW PUSH EVENT (most reliable to prove delivery)
 * If you don't see the "SW push received" notification, push isn't reaching the SW at all.
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    // Always show debug proof that a push was received
await self.registration.showNotification("SW push received", {
  body: "Debug: service worker got a push event",
  tag: "webrtc-debug",
  renotify: true
});


    if (!event.data) return;

    let payload = null;
    try { payload = event.data.json(); } catch {}

    if (!payload) {
      try {
        const txt = await event.data.text();
        payload = txt ? JSON.parse(txt) : null;
      } catch {}
    }
    if (!payload) return;

    const data = extractData(payload);
    await showCallNotification(data);
  })());
});

/**
 * 2) Firebase handler (sometimes FCM routes here)
 * We keep it too, but it won’t hurt because tag replaces.
 */
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = extractData(payload);
    await showCallNotification(data);
  } catch {}
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
