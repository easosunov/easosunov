/* firebase-messaging-sw.js (RELIABLE: note + LOCAL timestamp + popup every call)
   - Works when Chrome is running even if page is closed
   - Handles BOTH delivery paths:
       A) messaging.onBackgroundMessage (Firebase path)
       B) self.addEventListener("push") (raw push path)
   - Uses a per-user tag BUT forces a popup by closing old notifications first
   - Includes caller note + LOCAL time in body
*/

importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain: "easosunov-webrtc.firebaseapp.com",
  projectId: "easosunov-webrtc",
  storageBucket: "easosunov-webrtc.firebasestorage.app",
  messagingSenderId: "100169991412",
  appId: "1:100169991412:web:27ef6820f9a59add6b4aa1",
});

const messaging = firebase.messaging();

// --- tiny in-memory dedupe (prevents double popups if both handlers fire) ---
const recentlyShown = new Map(); // callId -> ms
const DEDUPE_MS = 4000;

function extractData(payload) {
  return (
    payload?.data ||
    payload?.message?.data ||
    payload?.notification?.data ||
    payload?.message?.notification?.data ||
    {}
  );
}

function shouldDedupe(callId) {
  const now = Date.now();
  // purge old
  for (const [k, t] of recentlyShown.entries()) {
    if (now - t > DEDUPE_MS) recentlyShown.delete(k);
  }
  if (!callId) return false;
  if (recentlyShown.has(callId)) return true;
  recentlyShown.set(callId, now);
  return false;
}

async function showCallNotification(data) {
  data = data || {};

  const callId = String(data.callId || "");
  if (!callId) return;

  if (shouldDedupe(callId)) return;

  const toUid    = String(data.toUid || "");
  const roomId   = String(data.roomId || "");
  const fromName = String(data.fromName || "Unknown");
  const toName   = String(data.toName || "");
  const note     = String(data.note || "").trim();

  // LOCAL time on Person B computer
// LOCAL time on Person B computer
const tsMs = Number(data.sentAtMs || Date.now());  // Ensure sentAtMs is used
const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

// Notification title and body
const title = String(data.title || "Incoming call");
const body =
  `Call from ${fromName}` +
  (note ? ` — ${note}` : "") +
  (tsLocal ? ` — ${tsLocal}` : "");  // Include timestamp in body

  
 

  // Per-user tag so we don't stack endlessly
  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  // IMPORTANT: force a new popup every time by closing previous with same tag
  try {
    const existing = await self.registration.getNotifications({ tag });
    for (const n of existing) n.close();
  } catch {}

  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,              // re-alert if the OS treats it as a replacement
    requireInteraction: true,    // keep it visible until user acts
    timestamp: Number.isFinite(tsMs) ? tsMs : undefined,

    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
  });
}

/**
 * Path A: Firebase background handler (often used when Chrome is running)
 */
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = extractData(payload);
    await showCallNotification(data);
  } catch {
    // ignore
  }
});

/**
 * Path B: Raw push event (sometimes used depending on browser state)
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
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
