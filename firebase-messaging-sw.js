/* firebase-messaging-sw.js
   Option 2 (newest ringing call only) + replace tag + local time + caller note
   - Works whether FCM arrives via Firebase handler OR raw push event
   - Uses Firestore in SW to ignore older queued pushes (prevents burst on restart)
   - Shows notification ONLY if callId is newest ringing call for this toUid
   - Body includes: Call from X — note — LOCAL timestamp
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

const messaging = firebase.messaging();
const db = firebase.firestore();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// -------- helpers --------

function extractData(payload) {
  // Handles several real-world shapes
  const d =
    payload?.data ||
    payload?.message?.data ||
    payload?.message?.notification?.data ||
    payload?.notification?.data ||
    {};
  return d || {};
}

/**
 * Returns newest "ringing" callId for toUid, or:
 * - null if none
 * - "__unknown__" if query fails (fail-open)
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
    // Missing index / rules / offline / etc -> fail-open
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

  // LOCAL timestamp from sentAtMs
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  const title = String(data.title || "Incoming call");

  // Single line is most consistent across OS/Chrome
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

async function handleCallDataMaybeShow(data) {
  data = data || {};
  const callId = String(data.callId || "");
  if (!callId) return;

  const toUid = String(data.toUid || "");

  // Option 2: newest ringing call only (but fail-open if cannot query)
  if (toUid) {
    const newest = await getNewestRingingCallIdFor(toUid);

    if (newest === "__unknown__") {
      await showCallNotification(data);
      return;
    }
    if (!newest) return;          // no ringing calls anymore
    if (newest !== callId) return; // not newest => ignore
  }

  await showCallNotification(data);
}

// -------- delivery paths --------

/**
 * Path A: Firebase background handler (this is often the one used when Chrome is running)
 */
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = extractData(payload);
    await handleCallDataMaybeShow(data);
  } catch {
    // ignore
  }
});

/**
 * Path B: Raw push event (this is often used when Chrome was closed / restarted)
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
    await handleCallDataMaybeShow(data);
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
