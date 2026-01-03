/* firebase-messaging-sw.js (Option 2: newest ringing call only + replace tag + local time + note)
   - Uses Firestore in the SW to suppress old/duplicate queued pushes
   - Shows notification ONLY if payload.callId matches newest ringing call for toUid
   - Adds caller note + LOCAL timestamp in the body
   - Uses tag to replace (no stacking)
   - Uses raw "push" event only (avoid double notifications)
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

// We keep messaging initialized (not used directly here, but OK)
const messaging = firebase.messaging();
const db = firebase.firestore();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function extractData(payload) {
  // Data-only payloads commonly arrive as { data: {...} }
  // Some environments wrap it differently; keep a few fallbacks.
  return (
    payload?.data ||
    payload?.message?.data ||
    payload?.notification?.data ||
    payload?.message?.notification?.data ||
    {}
  );
}

/**
 * Returns newest "ringing" callId for a given toUid, or:
 * - null if none
 * - "__unknown__" if query fails (fail-open signal)
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
    // Missing index / permission / offline / etc.
    // Fail-open: allow showing the notification rather than dropping all calls.
    return "__unknown__";
  }
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

  // LOCAL timestamp: we expect Cloud Function to send sentAtMs
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single-line body is more consistent across OSes
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

  // Replace instead of stacking (per-user)
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
 * RAW PUSH EVENT (most reliable for data-only FCM webpush)
 * Option 2 filter is applied here.
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
    const callId = String(data.callId || "");
    const toUid  = String(data.toUid || "");

    if (!callId) return;

    // OPTION 2: only show if this callId is the newest ringing call for toUid
    if (toUid) {
      const newest = await getNewestRingingCallIdFor(toUid);

      // Fail-open: if we can't check, still show
      if (newest === "__unknown__") {
        await showCallNotification(data);
        return;
      }

      // No ringing calls anymore -> do not show
      if (!newest) return;

      // Not newest -> ignore (prevents bursts / old queued)
      if (newest !== callId) return;
    }

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
