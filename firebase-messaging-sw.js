/* firebase-messaging-sw.js - Simplified reliable version */
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore-compat.js");

// Initialize Firebase
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

// Android detection
const isAndroid = /Android/.test(navigator.userAgent);

// Message channel for communication
const messageChannel = new BroadcastChannel('sw_firestore_channel');

// Current user state
let currentUid = null;
let unsubscribeCallListener = null;

// --- Handle messages from web page ---
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set:', currentUid);
    
    // Send acknowledgment
    event.ports?.[0]?.postMessage({ 
      type: 'UID_ACK', 
      uid: data.uid,
      timestamp: Date.now() 
    });
  }
  
  if (data.type === 'CLEAR_UID') {
    currentUid = null;
    console.log('[SW] UID cleared');
    if (unsubscribeCallListener) {
      unsubscribeCallListener();
      unsubscribeCallListener = null;
    }
  }
});

// --- Handle FCM background messages ---
messaging.onBackgroundMessage(async (payload) => {
  console.log('[SW] Received FCM background message:', payload);
  
  try {
    const data = payload?.data || {};
    
    if (data.callId && data.toUid === currentUid) {
      await showCallNotification(data);
    } else {
      console.log('[SW] Ignoring FCM message - no callId or UID mismatch');
    }
  } catch (error) {
    console.error('[SW] Error in onBackgroundMessage:', error);
  }
});

// --- Handle push events (direct from FCM) ---
self.addEventListener("push", (event) => {
  console.log('[SW] Push event received');
  
  event.waitUntil((async () => {
    if (!event.data) {
      console.log('[SW] Push event has no data');
      return;
    }
    
    let payload;
    try {
      payload = event.data.json();
    } catch (jsonError) {
      try {
        const text = await event.data.text();
        payload = text ? JSON.parse(text) : null;
      } catch (textError) {
        console.error('[SW] Failed to parse push data:', textError);
        return;
      }
    }
    
    if (!payload) return;
    
    const data = payload?.data || {};
    
    // Show notification for call
    if (data.callId) {
      await showCallNotification(data);
    }
  })());
});

// --- Show call notification ---
async function showCallNotification(data) {
  if (!data.callId) return;
  
  const callId = String(data.callId);
  const fromName = String(data.fromName || "Unknown");
  const note = String(data.note || "").trim();
  const roomId = String(data.roomId || "");
  
  // Create notification content
  const title = "📞 Incoming Call";
  let body = `From: ${fromName}`;
  if (note) body += ` - ${note}`;
  
  // Prepare notification data
  const notificationData = {
    callId,
    toUid: data.toUid || currentUid,
    roomId,
    fromName,
    note,
    sentAtMs: data.sentAtMs || Date.now(),
    source: 'fcm_push',
    launchUrl: `/easosunov/webrtc.html?callId=${callId}&roomId=${roomId}&fromName=${encodeURIComponent(fromName)}`
  };
  
  // Create notification options
  const notificationOptions = {
    body: body,
    icon: '/easosunov/icons/RTC192.png',
    badge: '/easosunov/icons/RTC96.png',
    tag: `call-${callId}`,
    renotify: true,
    requireInteraction: true, // Don't auto-dismiss
    timestamp: Date.now(),
    data: notificationData,
    actions: [
      {
        action: 'answer',
        title: 'Answer',
        icon: '/easosunov/icons/answer.png'
      },
      {
        action: 'decline',
        title: 'Decline',
        icon: '/easosunov/icons/decline.png'
      }
    ],
    silent: false, // Ensure sound plays
    vibrate: [500, 250, 500, 250, 1000] // Distinctive vibration
  };
  
  // Add Android-specific options
  if (isAndroid) {
    // Android requires specific format for persistent notifications
    notificationOptions.data.android = {
      channelId: 'incoming_calls',
      priority: 'high',
      visibility: 'public',
      ongoing: true, // Persistent notification
      autoCancel: false,
      fullScreenIntent: true
    };
  }
  
  try {
    // Close any existing notifications with same tag
    const existing = await self.registration.getNotifications({ 
      tag: notificationOptions.tag 
    });
    for (const n of existing) n.close();
    
    // Show the notification
    await self.registration.showNotification(title, notificationOptions);
    console.log('[SW] Notification shown for call:', callId);
    
    // Mark as delivered in Firestore if we have access
    if (callId && currentUid) {
      try {
        await firestore.collection('calls').doc(callId).update({
          deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
          deliveredVia: 'fcm_push',
          deliveredAtMs: Date.now()
        });
        console.log('[SW] Marked as delivered:', callId);
      } catch (firestoreError) {
        console.log('[SW] Could not update Firestore (normal if no permission):', firestoreError);
      }
    }
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

// --- Handle notification clicks ---
self.addEventListener("notificationclick", (event) => {
  console.log('[SW] Notification clicked:', event.notification?.data);
  
  event.notification.close();
  
  const data = event.notification?.data || {};
  const action = event.action;
  
  if (action === 'answer') {
    handleAnswerAction(data);
  } else if (action === 'decline') {
    handleDeclineAction(data);
  } else {
    handleDefaultClick(data);
  }
});

function handleAnswerAction(data) {
  const url = buildUrlWithParams('/easosunov/webrtc.html', {
    callId: data.callId,
    roomId: data.roomId,
    action: 'answer',
    autoJoin: 'true'
  });
  
  openOrFocusWindow(url);
}

function handleDeclineAction(data) {
  // Mark as declined in Firestore if possible
  if (data.callId) {
    firestore.collection('calls').doc(data.callId).update({
      status: 'declined',
      declinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      declinedVia: 'notification'
    }).catch(console.error);
  }
  
  // Show confirmation
  self.registration.showNotification('Call Declined', {
    body: `You declined call from ${data.fromName || 'unknown'}`,
    icon: '/easosunov/icons/RTC192.png',
    tag: `declined-${Date.now()}`
  });
}

function handleDefaultClick(data) {
  const url = buildUrlWithParams('/easosunov/webrtc.html', {
    callId: data.callId,
    roomId: data.roomId,
    fromName: data.fromName,
    note: data.note
  });
  
  openOrFocusWindow(url);
}

function buildUrlWithParams(base, params) {
  const url = new URL(base, self.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function openOrFocusWindow(url) {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });
  
  // Look for existing window
  for (const client of clients) {
    if (client.url.includes('/easosunov/')) {
      await client.focus();
      client.postMessage({
        type: 'NAVIGATE_TO_CALL',
        url: url,
        timestamp: Date.now()
      });
      return;
    }
  }
  
  // Open new window if none exists
  await self.clients.openWindow(url);
}

// --- Service worker lifecycle ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
  
  // Cache important resources
  event.waitUntil(
    caches.open('webrtc-v1').then(cache => {
      return cache.addAll([
        '/easosunov/webrtc.html',
        '/easosunov/icons/RTC192.png',
        '/easosunov/icons/RTC512.png',
        '/easosunov/manifest.json'
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(self.clients.claim());
});

console.log('[SW] Service Worker loaded');
