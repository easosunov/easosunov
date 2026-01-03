/* firebase-messaging-sw.js (WORKING + SIMPLE)
   - Shows: fromName + optional note + LOCAL time
   - No Firestore queries (so it never suppresses notifications)
   - Replaces instead of stacking using "tag"
   - Handles data-only pushes reliably via raw "push" event
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

// Keep messaging init (not strictly required if we use only "push", but ok)
firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function extractData(payload) {
  // Support multiple possible shapes
  return (
    payload?.data ||
    payload?.message?.data ||
    payload?.message?.notification?.data ||
    payload?.notification?.data ||
    {}
  );
}

async function showCallNotification(data) {
  data = data || {};

  const callId   = String(data.callId || "");
  if (!callId) return; // ignore non-call pushes

  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL timestamp (best effort)
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single-line body (more reliable across OSes)
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

/**
 * IMPORTANT: Use raw "push" handler (most reliable for data-only)
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    if (!event.data) return;

    let payload = null;

    // Try JSON first
    try { payload = event.data.json(); } catch {}

    // Fallback: text -> JSON
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
