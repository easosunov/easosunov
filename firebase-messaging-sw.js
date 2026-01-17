/* firebase-messaging-sw.js (ENHANCED: Direct Firestore Listener)
   - Works when Chrome is running even if page is closed
   - Listens to Firestore directly for incoming calls
   - Shows notifications even when browser is closed
   - Uses per-user tag to avoid duplicate notifications
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
const firestore = firebase.firestore();

// --- In-memory state ---
const recentlyShown = new Map(); // callId -> ms
const DEDUPE_MS = 4000;
let currentUid = null;
let unsubscribeCallListener = null;

// Message channel to communicate with web page
const messageChannel = new BroadcastChannel('sw_firestore_channel');

// Listen for messages from web page (when user logs in/out)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set:', currentUid);
    
    // Start listening for calls for this user
    startFirestoreListener(data.uid);
  }
  
  if (data.type === 'CLEAR_UID') {
    currentUid = null;
    console.log('[SW] UID cleared');
    
    // Stop listening
    if (unsubscribeCallListener) {
      unsubscribeCallListener();
      unsubscribeCallListener = null;
    }
  }
});

// Start listening to Firestore for incoming calls
function startFirestoreListener(uid) {
  // Stop any existing listener
  if (unsubscribeCallListener) {
    unsubscribeCallListener();
  }
  
  if (!uid) return;
  
  console.log('[SW] Starting Firestore listener for UID:', uid);
  
  try {
    // Listen for incoming calls addressed to this UID
    const callsQuery = firestore
      .collection('calls')
      .where('toUid', '==', uid)
      .where('status', '==', 'ringing');
    
unsubscribeCallListener = callsQuery.onSnapshot(
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const callData = change.doc.data();
        const callId = change.doc.id;
        
        console.log('[SW] Firestore new call detected:', callId);
        
        // NEW: Check if this call is too old
        const currentTime = Date.now();
        const callCreatedAt = callData.createdAt ? 
          callData.createdAt.toMillis() : 
          (callData.sentAtMs || 0);
        
        // If call is older than 2 minutes (120,000 ms), ignore it
        if (callCreatedAt > 0 && (currentTime - callCreatedAt) > 120000) {
          console.log('[SW] Ignoring old call:', callId, 'age:', currentTime - callCreatedAt, 'ms');
          
          // Auto-mark old calls as "expired"
          firestore.collection('calls').doc(callId).update({
            status: 'expired',
            expiredAtMs: currentTime,
            expiredReason: 'service_worker_auto_expire'
          }).catch(err => console.error('[SW] Error marking as expired:', err));
          
          return; // Skip this call
        }
        
        // Check if web page is already showing this call
        checkIfPageHandled(callId, callData).then((pageHandled) => {
          if (!pageHandled) {
            // Web page isn't handling it, show notification
            showCallNotification({
              callId: callId,
              toUid: uid,
              roomId: callData.roomId,
              fromName: callData.fromName || 'Unknown',
              toName: callData.toName || '',
              note: callData.note || '',
              sentAtMs: Date.now()
            });
            
            // Mark as delivered in Firestore
            markAsDelivered(callId);
          }
        });
      }
    });
  },
      (error) => {
        console.error('[SW] Firestore listener error:', error);
      }
    );
    
    console.log('[SW] Firestore listener started');
  } catch (error) {
    console.error('[SW] Error starting Firestore listener:', error);
  }
}

// Check if the web page is already handling this call
async function checkIfPageHandled(callId, callData) {
  try {
    // Send message to web page to check
    messageChannel.postMessage({
      type: 'CHECK_CALL',
      callId: callId,
      data: callData
    });
    
    // Wait a bit to see if web page responds
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if call has been marked as delivered
    const callDoc = await firestore.collection('calls').doc(callId).get();
    if (callDoc.exists) {
      const call = callDoc.data();
      return !!call.deliveredAt;
    }
    
    return false;
  } catch (error) {
    console.error('[SW] Error checking if page handled:', error);
    return false;
  }
}

// Mark call as delivered in Firestore
function markAsDelivered(callId) {
  firestore.collection('calls').doc(callId).update({
    deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
    deliveredVia: 'service_worker',
    deliveredAtMs: Date.now()
  }).catch(error => {
    console.error('[SW] Error marking as delivered:', error);
  });
}

function shouldDedupe(callId) {
  const now = Date.now();
  // purge old entries
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
  const tsMs = Number(data.sentAtMs || Date.now());
  const tsLocal = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : "";

  // Notification title and body
  const title = "📞 Incoming Call";
  const body =
    `Call from ${fromName}` +
    (note ? ` — ${note}` : "") +
    (tsLocal ? ` — ${tsLocal}` : "");

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
    icon: '/easosunov/icon.png', // Make sure you have this icon

    data: { 
      callId, 
      toUid, 
      roomId, 
      fromName, 
      toName, 
      note, 
      sentAtMs: String(tsMs),
      source: 'service_worker_firestore'
    },
  });
}

/**
 * Path A: Firebase background handler (FCM push)
 */
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = payload?.data || payload?.message?.data || {};
    await showCallNotification(data);
  } catch (error) {
    console.error('[SW] Error in onBackgroundMessage:', error);
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

    const data = payload?.data || payload?.message?.data || {};
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

// Clean up on service worker shutdown
self.addEventListener('activate', (event) => {
  console.log('[SW] Activated');
  event.waitUntil(self.clients.claim());
});

console.log('[SW] Enhanced Service Worker loaded with Firestore listener');
