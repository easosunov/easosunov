/* firebase-messaging-sw.js - UPDATED FOR iOS COMPATIBILITY */

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

// === iOS FIX === Detect iOS
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// === iOS FIX === Use different notification strategies for iOS
const recentlyShown = new Map();
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
  const tsMs     = Number(data.sentAtMs || Date.now());
  const tsLocal  = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  // === iOS FIX === Different title/body format for iOS
  const title = isIOS ? `📞 Call from ${fromName}` : "Incoming call";
  const body = isIOS 
    ? (note ? `${note}` : "Tap to answer")
    : `Call from ${fromName}` + (note ? ` — ${note}` : "") + (tsLocal ? ` — ${tsLocal}` : "");

  // Per-user tag
  const tag = toUid ? `webrtc-call-${toUid}` : "webrtc-call";

  // === iOS FIX === Different notification options for iOS
  const notificationOptions = {
    body,
    tag,
    renotify: true,
    requireInteraction: true,
    timestamp: Number.isFinite(tsMs) ? tsMs : undefined,
    icon: '/easosunov/icons/RTC192.png',
    badge: '/easosunov/icons/RTC192.png',
    data: { callId, toUid, roomId, fromName, toName, note, sentAtMs: String(tsMs) },
    
    // === iOS FIX === Add actions for iOS (won't work in web, but included for future native wrapper)
    actions: isIOS ? [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' }
    ] : []
  };

  // Close previous notifications
  try {
    const existing = await self.registration.getNotifications({ tag });
    for (const n of existing) n.close();
  } catch {}

  // === iOS FIX === Use different notification strategy for iOS
  if (isIOS) {
    // iOS: Always show with vibration pattern
    notificationOptions.vibrate = [200, 100, 200, 100, 200];
    notificationOptions.silent = false;
  }

  await self.registration.showNotification(title, notificationOptions);
  
  // === iOS FIX === For iOS, also send a message to all clients
  if (isIOS) {
    try {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'INCOMING_CALL',
          callId,
          fromName,
          roomId,
          note
        });
      });
    } catch {}
  }
}

/**
 * Path A: Firebase background handler
 */
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = extractData(payload);
    
    // === iOS FIX === For iOS, we need to handle foreground/background differently
    if (isIOS) {
      // iOS often doesn't fire onBackgroundMessage reliably
      // Use both handlers
      console.log('[iOS] Firebase background message:', data.callId);
    }
    
    await showCallNotification(data);
  } catch {
    // ignore
  }
});

/**
 * Path B: Raw push event
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
    
    // === iOS FIX === Log for debugging
    if (isIOS) {
      console.log('[iOS] Raw push event:', data.callId);
    }
    
    await showCallNotification(data);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const d = event.notification.data || {};
  const url = new URL("/easosunov/webrtc.html", self.location.origin);

  // === iOS FIX === Handle action buttons
  if (event.action === 'answer') {
    url.searchParams.set("autoAnswer", "true");
  } else if (event.action === 'decline') {
    url.searchParams.set("autoDecline", "true");
  }

  if (d.callId) url.searchParams.set("callId", d.callId);
  if (d.roomId) url.searchParams.set("roomId", d.roomId);
  if (d.fromName) url.searchParams.set("fromName", d.fromName);
  if (d.toName) url.searchParams.set("toName", d.toName);
  if (d.note) url.searchParams.set("note", d.note);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      // Check if there's already a window/tab open
      for (const client of clientList) {
        if (client.url.includes('/easosunov/') && 'focus' in client) {
          client.navigate(url.toString());
          return client.focus();
        }
      }
      // If no client is open, open a new window
      return self.clients.openWindow(url.toString());
    })
  );
});

// === iOS FIX === Listen for messages from web page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
