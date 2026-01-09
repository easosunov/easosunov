/* firebase-messaging-sw.js - Android Background Fix */
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

// Android detection and state
const isAndroid = /Android/.test(navigator.userAgent);
let currentUid = null;
let notificationCheckInterval = null;

// --- Service Worker Registration Check ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker for Android background');
  
  // Force immediate activation
  self.skipWaiting();
  
  // Cache critical resources
  event.waitUntil(
    caches.open('webrtc-pwa-v2').then(cache => {
      return cache.addAll([
        '/easosunov/webrtc.html',
        '/easosunov/icons/RTC192.png',
        '/easosunov/icons/RTC512.png',
        '/easosunov/manifest.json',
        '/easosunov/firebase-messaging-sw.js'
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  
  event.waitUntil(
    Promise.all([
      // Take control of all clients immediately
      self.clients.claim(),
      
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== 'webrtc-pwa-v2') {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      
      // Start background sync if supported
      ('periodicSync' in self.registration) ? 
        self.registration.periodicSync.register('check-calls', {
          minInterval: 24 * 60 * 60 * 1000 // 24 hours
        }).then(() => {
          console.log('[SW] Periodic sync registered');
        }).catch(console.error) : 
        Promise.resolve()
    ])
  );
  
  // Start checking for incoming calls in background
  startBackgroundCallCheck();
});

// --- Background call checking (for when PWA is closed) ---
function startBackgroundCallCheck() {
  if (notificationCheckInterval) {
    clearInterval(notificationCheckInterval);
  }
  
  // Check every 5 minutes for new calls
  notificationCheckInterval = setInterval(() => {
    if (currentUid) {
      checkForMissedCalls(currentUid).catch(console.error);
    }
  }, 5 * 60 * 1000); // 5 minutes
  
  console.log('[SW] Background call checker started');
}

async function checkForMissedCalls(uid) {
  try {
    console.log('[SW] Background check for UID:', uid);
    
    // Query Firestore for recent calls
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const callsSnapshot = await firestore
      .collection('calls')
      .where('toUid', '==', uid)
      .where('status', '==', 'ringing')
      .where('createdAt', '>', oneHourAgo)
      .limit(5)
      .get();
    
    if (!callsSnapshot.empty) {
      console.log(`[SW] Found ${callsSnapshot.size} ringing calls in background`);
      
      callsSnapshot.forEach(doc => {
        const callData = doc.data();
        showCallNotification({
          callId: doc.id,
          toUid: uid,
          roomId: callData.roomId,
          fromName: callData.fromName || 'Unknown',
          note: callData.note || '',
          sentAtMs: callData.createdAt?.toMillis?.() || Date.now()
        }).catch(console.error);
      });
    }
  } catch (error) {
    console.error('[SW] Background check error:', error);
  }
}

// --- Handle messages from web page ---
self.addEventListener('message', async (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set for background:', currentUid);
    
    // Store UID in IndexedDB for persistence
    await storeUidInIndexedDB(currentUid);
    
    // Send acknowledgment
    event.ports?.[0]?.postMessage({ 
      type: 'UID_ACK', 
      uid: currentUid,
      timestamp: Date.now() 
    });
  }
  
  if (data.type === 'GET_UID') {
    // Return stored UID
    const storedUid = await getUidFromIndexedDB();
    event.ports?.[0]?.postMessage({
      type: 'UID_RESPONSE',
      uid: storedUid
    });
  }
  
  if (data.type === 'TEST_NOTIFICATION') {
    // Test notification from web page
    showCallNotification({
      callId: 'test-' + Date.now(),
      toUid: currentUid,
      roomId: 'test-room',
      fromName: 'Test Caller',
      note: 'This is a test notification',
      sentAtMs: Date.now()
    }).then(() => {
      event.ports?.[0]?.postMessage({ type: 'TEST_SUCCESS' });
    }).catch(error => {
      event.ports?.[0]?.postMessage({ type: 'TEST_ERROR', error: error.message });
    });
  }
});

// --- IndexedDB for UID persistence ---
async function storeUidInIndexedDB(uid) {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('sw_storage', 'readwrite');
    const store = tx.objectStore('sw_storage');
    await store.put({ key: 'current_uid', value: uid, timestamp: Date.now() });
    await tx.complete;
    console.log('[SW] UID stored in IndexedDB');
  } catch (error) {
    console.error('[SW] Error storing UID:', error);
  }
}

async function getUidFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('sw_storage', 'readonly');
    const store = tx.objectStore('sw_storage');
    const result = await store.get('current_uid');
    await tx.complete;
    return result?.value || null;
  } catch (error) {
    console.error('[SW] Error getting UID:', error);
    return null;
  }
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sw_storage_db', 1);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sw_storage')) {
        db.createObjectStore('sw_storage', { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// --- Handle FCM background messages (CRITICAL FOR ANDROID) ---
messaging.onBackgroundMessage(async (payload) => {
  console.log('[SW] FCM background message received (app closed):', payload);
  
  // IMPORTANT: Show notification immediately
  const data = payload?.data || {};
  
  if (data.callId) {
    // Get UID from IndexedDB if not in memory
    if (!currentUid) {
      currentUid = await getUidFromIndexedDB();
    }
    
    // Check if this notification is for current user
    if (currentUid && data.toUid === currentUid) {
      await showCallNotification(data);
    } else if (!data.toUid) {
      // If no toUid in data, show anyway (might be for current user)
      await showCallNotification(data);
    }
  }
});

// --- Handle push events ---
self.addEventListener("push", (event) => {
  console.log('[SW] Push event received');
  
  // Parse push data
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
  
  // Show notification
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
    
    // Notification data
    const notificationData = {
      callId,
      toUid: data.toUid || currentUid,
      roomId,
      fromName,
      note,
      sentAtMs: data.sentAtMs || Date.now(),
      source: 'service_worker',
      launchUrl: `/easosunov/webrtc.html?callId=${callId}&roomId=${roomId}&fromName=${encodeURIComponent(fromName)}&note=${encodeURIComponent(note)}&ts=${Date.now()}`
    };
    
    // Create notification
    const notificationOptions = {
      body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      tag: `call-${callId}`,
      renotify: true,
      requireInteraction: true, // Don't auto-dismiss
      silent: false, // Ensure sound
      timestamp: Date.now(),
      data: notificationData,
      actions: [
        {
          action: 'answer',
          title: '📞 Answer',
          icon: '/easosunov/icons/answer.png'
        },
        {
          action: 'decline',
          title: '❌ Decline',
          icon: '/easosunov/icons/decline.png'
        }
      ],
      vibrate: [1000, 500, 1000, 500, 2000]
    };
    
    // Android-specific enhancements
    if (isAndroid) {
      // Use Android-specific options
      notificationOptions.data.android = {
        channelId: 'incoming_calls',
        priority: 'max',
        visibility: 'public',
        sound: 'default',
        vibrate: 'default',
        ongoing: true, // Persistent
        autoCancel: false,
        fullScreenIntent: true // Show on locked screen
      };
      
      // Also add to main data for compatibility
      notificationOptions.data.priority = 'high';
      notificationOptions.data.sound = 'default';
    }
    
    // Show notification
    await self.registration.showNotification(title, notificationOptions);
    console.log('[SW] Notification shown (background):', callId);
    
    // Mark as delivered in Firestore if possible
    try {
      if (callId && callId !== 'unknown') {
        await firestore.collection('calls').doc(callId).update({
          deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
          deliveredVia: 'service_worker_background',
          deliveredAtMs: Date.now()
        });
      }
    } catch (firestoreError) {
      // Silent fail - normal if no permission
    }
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

// --- Handle notification clicks ---
self.addEventListener("notificationclick", (event) => {
  console.log('[SW] Notification clicked (background):', event.notification?.data);
  
  event.notification.close();
  
  const data = event.notification?.data || {};
  const action = event.action;
  
  // Build URL based on action
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
    
    // Mark as answered
    if (data.callId) {
      firestore.collection('calls').doc(data.callId).update({
        answeredVia: 'notification_background',
        answeredAtMs: Date.now()
      }).catch(console.error);
    }
  } else if (action === 'decline') {
    params.action = 'decline';
    
    // Mark as declined
    if (data.callId) {
      firestore.collection('calls').doc(data.callId).update({
        status: 'declined',
        declinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        declinedVia: 'notification_background'
      }).catch(console.error);
    }
  }
  
  // Build URL
  const urlObj = new URL(url, self.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) urlObj.searchParams.set(key, value);
  });
  
  url = urlObj.toString();
  
  // Open or focus window
  event.waitUntil(
    (async () => {
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
      
      // Open new window
      await self.clients.openWindow(url);
    })()
  );
});

// --- Periodic background sync (if supported) ---
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-calls') {
    console.log('[SW] Periodic sync triggered');
    event.waitUntil(
      (async () => {
        if (currentUid) {
          await checkForMissedCalls(currentUid);
        }
      })()
    );
  }
});

console.log('[SW] Android Background Service Worker loaded');
