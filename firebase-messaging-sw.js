/* firebase-messaging-sw.js - Android Ringtone Version */
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
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

// Audio context for playing ringtone (limited in Service Worker)
let audioContext = null;
let ringtoneSource = null;
let ringtoneTimer = null;
let ringtoneTimeout = null;
const RINGTONE_DURATION = 60000; // Ring for 60 seconds

// Current user state
let currentUid = null;

// --- Handle messages from web page ---
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set:', currentUid);
  }
  
  if (data.type === 'STOP_RINGTONE') {
    stopRingtone();
  }
});

// --- Audio functions for ringtone ---
async function playRingtone() {
  try {
    console.log('[SW] Attempting to play ringtone...');
    
    // Stop any existing ringtone first
    stopRingtone();
    
    // Note: Service Workers have limited audio capabilities
    // We'll try to play a simple tone as a fallback
    
    // Create a simple beep pattern (beep every 2 seconds)
    let beepCount = 0;
    const maxBeeps = Math.floor(RINGTONE_DURATION / 2000);
    
    ringtoneTimer = setInterval(() => {
      // Create a simple notification to trigger sound
      // This is a workaround since Service Workers can't play audio directly
      self.registration.showNotification('📞 Ringing...', {
        body: 'Incoming call',
        tag: 'ringtone-beep-' + Date.now(),
        silent: false,
        requireInteraction: false,
        vibrate: [200, 100, 200],
        // Close immediately to not show visually
      }).then(notification => {
        // Close immediately - we just want the sound
        setTimeout(() => notification.close(), 100);
      });
      
      beepCount++;
      if (beepCount >= maxBeeps) {
        stopRingtone();
      }
    }, 2000);
    
    console.log('[SW] Ringtone pattern started');
    
    // Auto-stop after duration
    ringtoneTimeout = setTimeout(() => {
      stopRingtone();
    }, RINGTONE_DURATION);
    
  } catch (error) {
    console.error('[SW] Error playing ringtone:', error);
  }
}

function stopRingtone() {
  if (ringtoneTimer) {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  
  if (ringtoneTimeout) {
    clearTimeout(ringtoneTimeout);
    ringtoneTimeout = null;
  }
  
  console.log('[SW] Ringtone stopped');
}

// --- Create Android notification with sound priority ---
function createAndroidNotification(title, body, data) {
  // For Android, we need to create a high-priority notification
  // that triggers the default ringtone
  
  const notificationData = {
    callId: data.callId,
    toUid: data.toUid,
    roomId: data.roomId,
    fromName: data.fromName,
    note: data.note,
    sentAtMs: data.sentAtMs,
    source: 'android_ringtone',
    launchUrl: data.launchUrl
  };
  
  return {
    title: title,
    body: body,
    icon: '/easosunov/icons/RTC192.png',
    badge: '/easosunov/icons/RTC96.png',
    tag: `call-${data.callId}`,
    renotify: true,
    requireInteraction: true, // Critical for Android to keep showing
    silent: false, // MUST be false for sound
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
    // Android-specific options
    vibrate: [1000, 500, 1000, 500, 2000, 500, 1000], // Long distinctive pattern
    // Add sound configuration
    sound: 'default', // Use default notification sound
    // Priority settings for Android
    priority: 2, // High priority (Android)
    // Android notification channel settings
    android: {
      channelId: 'incoming_calls_channel',
      priority: 'high',
      visibility: 'public',
      sound: 'default',
      vibrate: 'default',
      lights: ['#4CAF50', 1000, 1000],
      // Make it sticky/ongoing
      ongoing: true,
      autoCancel: false
    }
  };
}

// --- Handle FCM background messages ---
messaging.onBackgroundMessage(async (payload) => {
  console.log('[SW] Received FCM background message:', payload);
  
  try {
    const data = payload?.data || {};
    
    if (data.callId) {
      await showCallNotification(data);
      
      // Start ringtone for Android
      if (isAndroid) {
        await playRingtone();
      }
    }
  } catch (error) {
    console.error('[SW] Error in onBackgroundMessage:', error);
  }
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
    launchUrl: `/easosunov/webrtc.html?callId=${callId}&roomId=${roomId}&fromName=${encodeURIComponent(fromName)}&note=${encodeURIComponent(note)}`
  };
  
  // Create notification options based on platform
  let notificationOptions;
  
  if (isAndroid) {
    notificationOptions = createAndroidNotification(title, body, notificationData);
  } else if (isIOS) {
    // iOS specific options
    notificationOptions = {
      title: title,
      body: body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      tag: `call-${callId}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
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
      sound: 'default'
    };
  } else {
    // Desktop/other platforms
    notificationOptions = {
      title: title,
      body: body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      tag: `call-${callId}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
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
      ]
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
    
    // For Android, start periodic re-notification to keep sound playing
    if (isAndroid) {
      // Re-show notification every 15 seconds to keep it fresh and playing sound
      const renotificationInterval = setInterval(async () => {
        try {
          await self.registration.showNotification(title + ' 📞', notificationOptions);
        } catch (e) {
          clearInterval(renotificationInterval);
        }
      }, 15000);
      
      // Stop after 60 seconds
      setTimeout(() => {
        clearInterval(renotificationInterval);
      }, RINGTONE_DURATION);
    }
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

// --- Handle notification clicks ---
self.addEventListener("notificationclick", (event) => {
  console.log('[SW] Notification clicked:', event.notification?.data);
  
  event.notification.close();
  stopRingtone(); // Stop ringtone when notification is clicked
  
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
  if (data.callId) {
    firestore.collection('calls').doc(data.callId).update({
      status: 'declined',
      declinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      declinedVia: 'notification'
    }).catch(console.error);
  }
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
  
  await self.clients.openWindow(url);
}

// --- Service worker lifecycle ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
  
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

console.log('[SW] Android Ringtone Service Worker loaded');
