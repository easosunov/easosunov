/* firebase-messaging-sw.js (stable SW version) */
/* Implements:
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

const messaging = firebase.messaging();
const db = firebase.firestore();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Returns the newest "ringing" callId for a given toUid, or null if none.
 * If the query fails (missing index / offline / etc), returns null.
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
    // If index is missing, Firestore can throw here.
    // We fail open (return null) so user still gets something.
    return null;
  }
}

/**
 * Show a call notification, but REPLACE existing via tag (Option 2).
 */
async function showCallNotification(payload) {
  const data = payload?.data || {};

  const callId  = data.callId || "";
  const toUid   = data.toUid  || ""; // required for Option 1
  const roomId  = data.roomId || "";
   const fromName = data.fromName || "Unknown";
  const toName   = data.toName   || "";

  // NEW: optional short message from caller
  const note = data.note || "";

  // NEW: local-time timestamp (prefer caller-provided ms if present; fallback to "now")
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";


  const title = payload?.notification?.title || "Incoming call";

  // NEW: build body lines (call + optional message + local time)
  const lines = [];
  lines.push(`Call from ${fromName}`);
  if (note) lines.push(String(note));
  if (tsLocal) lines.push(String(tsLocal));

  const body = lines.join("\n");


  // Option 2: use a stable tag so notifications REPLACE instead of stacking.
  // Per-user tag prevents weirdness if the same browser ever signs into another UID.
  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

    const options = {
    body,
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },


    // Replace instead of stacking:
    tag,
    renotify: false
  };

  await self.registration.showNotification(title, options);
}

/**
 * MAIN: background message handler
 * Option 1: Only show if this payload.callId matches newest ringing call for toUid.
 * Option 2: use tag to replace instead of stacking.
 */
messaging.onBackgroundMessage((payload) => {
  eventWaitUntil(async () => {
    const data = payload?.data || {};
    const callId = data.callId || null;
    const toUid  = data.toUid  || null;

    // Not a call => ignore (or you can show a generic notification if you want)
    if (!callId) return;

    // Option 1:
    // If we know toUid, only show the notification if this callId is the newest ringing call.
    if (toUid) {
      const newest = await getNewestRingingCallIdFor(toUid);

      // If there is a newer ringing call, ignore this push to prevent spam on restart.
      if (newest && newest !== callId) return;

      // If there are no ringing calls anymore, ignore (call already ended/accepted/declined).
      if (!newest) return;
    }

    // Show single (replacing) notification
    await showCallNotification(payload);
  });
});

/**
 * Helper: safely wrap async in SW so it doesn't get killed mid-flight.
 */
function eventWaitUntil(fn) {
  // If we’re in a context where we can use waitUntil, do it.
  // For onBackgroundMessage, we don't get an event object, so we just run it.
  // Most browsers still complete promises here, but this makes it robust when called from other listeners too.
  try {
    const p = Promise.resolve().then(fn);
    return p;
  } catch {
    // ignore
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
