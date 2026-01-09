/* firebase-messaging-sw.js - Minimal version for Android background */
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js");

// Initialize Firebase (MINIMAL - no Firestore)
firebase.initializeApp({
  apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain: "easosunov-webrtc.firebaseapp.com",
  projectId: "easosunov-webrtc",
  storageBucket: "easosunov-webrtc.firebasestorage.app",
  messagingSenderId: "100169991412",
  appId: "1:100169991412:web:27ef6820f9a59add6b4aa1",
});

const messaging = firebase.messaging();

// Simple state
let currentUid = null;

// --- Service Worker Lifecycle ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(self.clients.claim()); // Take control immediately
});

// --- Handle messages from web page ---
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set:', currentUid);
    
    // Store in storage for persistence
    self.registration.sync?.register('store-uid').catch(() => {});
    
    // Acknowledge
    event.ports?.[0]?.postMessage({ 
      type: 'UID_ACK', 
      uid: currentUid,
      timestamp: Date.now() 
    });
  }
  
  if (data.type === 'TEST_NOTIFICATION') {
    // Simple test notification
    self.registration.showNotification('Test', {
      body: 'Service worker is working',
      icon: '/easosunov/icons/RTC192.png',
      tag: 'test-' + Date.now()
    }).then(() => {
      event.ports?.[0]?.postMessage({ type: 'TEST_SUCCESS' });
    });
  }
});

// --- Handle FCM background messages ---
messaging.onBackgroundMessage(async (payload) => {
  console.log('[SW] Received FCM background message');
  
  const data = payload?.data || {};
  
  if (data.callId) {
    await showCallNotification(data);
  }
});

// --- Handle push events ---
self.addEventListener("push", (event) => {
  console.log('[SW] Push event received');
  
  let payload;
  try {
    payload = event.data?.json();
  } catch (e) {
    try {
      payload = JSON.parse(event.data?.text() || '{}');
    } catch (e2) {
      console.error('[SW] Failed to parse push data');
      payload = {};
    }
  }
  
  const data = payload?.data || {};
  
  event.waitUntil(
    (async () => {
      if (data.callId) {
        await showCallNotification(data);
      }
    })()
  );
});

// --- Show call notification ---
async function showCallNotification(data) {
  try {
    const callId = String(data.callId || 'unknown');
    const fromName = String(data.fromName || "Unknown");
    const note = String(data.note || "").trim();
    const roomId = String(data.roomId || "");
    
    const title = "📞 Incoming Call";
    let body = `From: ${fromName}`;
    if (note) body += ` - ${note}`;
    
    // Build launch URL
    const launchUrl = `/easosunov/webrtc.html?callId=${callId}&roomId=${roomId}&fromName=${encodeURIComponent(fromName)}&note=${encodeURIComponent(note)}`;
    
    // Simple notification options
    const notificationOptions = {
      body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      tag: `call-${callId}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      timestamp: Date.now(),
      data: {
        callId,
        roomId,
        fromName,
        note,
        launchUrl
      },
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
      vibrate: [500, 250, 500, 250, 1000]
    };
    
    // Show notification
    await self.registration.showNotification(title, notificationOptions);
    console.log('[SW] Notification shown:', callId);
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

// --- Handle notification clicks ---
self.addEventListener("notificationclick", (event) => {
  console.log('[SW] Notification clicked');
  
  event.notification.close();
  
  const data = event.notification?.data || {};
  const action = event.action;
  
  // Build URL
  let url = `/easosunov/webrtc.html`;
  const params = {
    callId: data.callId,
    roomId: data.roomId,
    fromName: data.fromName,
    note: data.note
  };
  
  if (action === 'answer') {
    params.action = 'answer';
    params.autoJoin = 'true';
  } else if (action === 'decline') {
    params.action = 'decline';
  }
  
  // Construct URL
  const urlObj = new URL(url, self.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) urlObj.searchParams.set(key, value);
  });
  
  const finalUrl = urlObj.toString();
  
  // Open or focus window
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      
      // Find existing window
      for (const client of clients) {
        if (client.url.includes('/easosunov/')) {
          await client.focus();
          client.postMessage({
            type: 'NAVIGATE_TO_CALL',
            url: finalUrl,
            timestamp: Date.now()
          });
          return;
        }
      }
      
      // Open new window
      await self.clients.openWindow(finalUrl);
    })()
  );
});

console.log('[SW] Simple Service Worker loaded');
