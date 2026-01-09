/* firebase-messaging-sw.js - Enhanced for Android PWA */
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
// Audio context for playing ringtone
let audioContext = null;
let ringtoneSource = null;
let ringtoneTimer = null;
const RINGTONE_DURATION = 45000; // Ring for 45 seconds

// --- In-memory state ---
const recentlyShown = new Map();
const DEDUPE_MS = 4000;
let currentUid = null;
let unsubscribeCallListener = null;

// Channel for communication with web page
const messageChannel = new BroadcastChannel('sw_firestore_channel');

// Android-specific: Check if we're on Android
const isAndroid = /Android/.test(navigator.userAgent);

// --- Enhanced notification handling for Android ---
function createAndroidNotificationPayload(title, body, data) {
  // For Android, we need to use a different approach
  if (isAndroid) {
    return {
      title: title,
      body: body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      image: '/easosunov/icons/RTC512.png',
      timestamp: Date.now(),
      vibrate: [1000, 500, 1000, 500, 2000], // Longer vibration pattern
      requireInteraction: true, // Critical: prevents auto-dismiss
      tag: `persistent-call-${data.callId || Date.now()}`,
      renotify: true,
      silent: false, // Must be false for sound
      sound: 'default', // Explicitly request default sound
      priority: 2, // High priority (Android-specific)
      // Android-specific options
      data: {
        ...data,
        // Force Android to show as high priority call notification
        notificationType: 'call',
        callType: 'incoming',
        timestamp: Date.now(),
        // Android channel settings
        channelId: 'incoming_calls_channel',
        channelName: 'Incoming Calls',
        channelDescription: 'Incoming video call notifications',
        importance: 'high',
        // Make it sticky/ongoing
        ongoing: true,
        autoCancel: false,
        // Visibility settings
        visibility: 'public',
        // Full screen intent for locked screens
        fullScreenIntent: true,
        // LED and light settings
        lights: [true, 1000, 1000],
        color: '#4CAF50'
      },
      // Add actions that will keep notification alive
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
      ]
    };
  } else {
    // Standard for other platforms
    return {
      title: title,
      body: body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      image: '/easosunov/icons/RTC512.png',
      timestamp: Date.now(),
      vibrate: [200, 100, 200],
      requireInteraction: true,
      tag: `call-${data.callId || Date.now()}`,
      renotify: true,
      silent: false,
      data: {
        ...data,
        androidChannelId: 'incoming_calls',
        androidChannelName: 'Incoming Calls',
        androidChannelDescription: 'Incoming video call notifications',
        androidPriority: 'high',
        androidVisibility: 'public',
        androidAutoCancel: false,
        androidDefaults: ['sound', 'vibrate'],
        androidLights: ['#4CAF50', 300, 1000]
      }
    };
  }
}

// --- Audio functions for ringtone ---
function initAudioContext() {
  if (!audioContext) {
    try {
      audioContext = new (self.AudioContext || self.webkitAudioContext)();
    } catch (e) {
      console.error('[SW] Could not create AudioContext:', e);
    }
  }
  return audioContext;
}

async function playRingtone() {
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    // Resume audio context (required by browsers)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    // Stop any existing ringtone
    stopRingtone();
    
    // Create oscillator for ringtone
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = 800;
    
    gainNode.gain.value = 0.3;
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Start the oscillator
    oscillator.start();
    
    // Store reference
    ringtoneSource = { oscillator, gainNode };
    
    // Create pulsing effect (on/off every 2 seconds)
    let isLoud = true;
    ringtoneTimer = setInterval(() => {
      if (ringtoneSource && ringtoneSource.gainNode) {
        ringtoneSource.gainNode.gain.value = isLoud ? 0.3 : 0.05;
        isLoud = !isLoud;
      }
    }, 2000);
    
    console.log('[SW] Ringtone started');
    
  } catch (error) {
    console.error('[SW] Error playing ringtone:', error);
  }
}

function stopRingtone() {
  if (ringtoneTimer) {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  
  if (ringtoneSource) {
    try {
      ringtoneSource.oscillator.stop();
      ringtoneSource.oscillator.disconnect();
      ringtoneSource.gainNode.disconnect();
    } catch (e) {
      // Ignore errors when stopping
    }
    ringtoneSource = null;
  }
}

// --- Handle messages from web page ---
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SET_UID') {
    currentUid = data.uid;
    console.log('[SW] UID set:', currentUid);
    startFirestoreListener(data.uid);
    
    // Send acknowledgment to web page
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
  
  if (data.type === 'CHECK_CALL') {
    // Web page asks if we should handle this call
    const response = {
      type: 'CALL_CHECK_RESPONSE',
      callId: data.callId,
      shouldHandle: true,
      timestamp: Date.now()
    };
    
    // If web page is already handling it, we shouldn't
    if (data.pageHandled) {
      response.shouldHandle = false;
    }
    
    event.ports?.[0]?.postMessage(response);
  }
});

// --- Start listening to Firestore for incoming calls ---
function startFirestoreListener(uid) {
  if (unsubscribeCallListener) {
    unsubscribeCallListener();
  }
  
  if (!uid) return;
  
  console.log('[SW] Starting Firestore listener for UID:', uid);
  
  try {
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
            
            // Check deduplication
            if (shouldDedupe(callId)) {
              console.log('[SW] Skipping duplicate call:', callId);
              return;
            }
            
            // Show notification immediately
            showCallNotification({
              callId: callId,
              toUid: uid,
              roomId: callData.roomId,
              fromName: callData.fromName || 'Unknown',
              toName: callData.toName || '',
              note: callData.note || '',
              sentAtMs: callData.createdAt?.toMillis?.() || Date.now()
            });
            
            // Mark as delivered
            markAsDelivered(callId);
          }
        });
      },
      (error) => {
        console.error('[SW] Firestore listener error:', error);
        // Attempt to restart listener after delay
        setTimeout(() => {
          if (currentUid) {
            startFirestoreListener(currentUid);
          }
        }, 5000);
      }
    );
  } catch (error) {
    console.error('[SW] Error starting Firestore listener:', error);
  }
}

function shouldDedupe(callId) {
  const now = Date.now();
  // Clean up old entries
  for (const [k, t] of recentlyShown.entries()) {
    if (now - t > DEDUPE_MS) recentlyShown.delete(k);
  }
  
  if (!callId) return false;
  if (recentlyShown.has(callId)) return true;
  
  recentlyShown.set(callId, now);
  return false;
}

async function markAsDelivered(callId) {
  try {
    await firestore.collection('calls').doc(callId).update({
      deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
      deliveredVia: 'service_worker',
      deliveredAtMs: Date.now(),
      swVersion: '2026-01-08-android'
    });
    console.log('[SW] Marked call as delivered:', callId);
  } catch (error) {
    console.error('[SW] Error marking as delivered:', error);
  }
}

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
  
  // Add timestamp if available
  if (data.sentAtMs) {
    const time = new Date(data.sentAtMs).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    body += ` at ${time}`;
  }
  
  // Prepare notification data
  const notificationData = {
    callId,
    toUid: data.toUid,
    roomId,
    fromName,
    note,
    sentAtMs: data.sentAtMs || Date.now(),
    source: 'service_worker_firestore',
    launchUrl: `/easosunov/webrtc.html?callId=${callId}&roomId=${roomId}`
  };
  
    // Create notification options
  let notificationOptions;
  
  if (isAndroid) {
    // Android-specific options with enhanced persistence
    notificationOptions = createAndroidNotificationPayload(title, body, notificationData);
    
    // Add additional options for Android to ensure it doesn't disappear
    notificationOptions = {
      ...notificationOptions,
      // Ensure it doesn't auto-dismiss
      requireInteraction: true,
      // Add actions
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
      // Prevent auto-hide and ensure sound
      silent: false,
      badge: '/easosunov/icons/RTC96.png',
      // Tag it for management
      tag: `persistent-call-${callId}`,
      // More distinctive vibration pattern
      vibrate: [200, 100, 200, 100, 200, 100, 400]
    };
  } else {
    // Standard options for other platforms
    notificationOptions = {
      body,
      icon: '/easosunov/icons/RTC192.png',
      badge: '/easosunov/icons/RTC96.png',
      tag: `call-${callId}`,
      renotify: true,
      requireInteraction: true, // Don't auto-dismiss
      timestamp: data.sentAtMs || Date.now(),
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
      // Ensure sound plays
      silent: false
    };
  }
  
   try {
    // Close any existing notifications with same tag
    const existing = await self.registration.getNotifications({ 
      tag: notificationOptions.tag 
    });
    for (const n of existing) n.close();
    
    // For Android, start playing ringtone BEFORE showing notification
    if (isAndroid) {
      await playRingtone();
      
      // Auto-stop ringtone after duration
      setTimeout(() => {
        stopRingtone();
        console.log('[SW] Ringtone stopped after timeout');
      }, RINGTONE_DURATION);
    }
    
    // Show the notification
    await self.registration.showNotification(title, notificationOptions);
    console.log('[SW] Notification shown:', callId);
    
    // For Android, set up aggressive persistence
    if (isAndroid) {
      // Create a persistent checking mechanism
      const persistentCheck = () => {
        self.registration.getNotifications({ tag: notificationOptions.tag })
          .then(notifications => {
            if (notifications.length === 0 && data.callId) {
              console.log('[SW] Android notification disappeared, re-creating');
              // Re-show the notification
              self.registration.showNotification(title, notificationOptions);
              
              // Continue ringtone if it stopped
              if (!ringtoneSource) {
                playRingtone();
              }
            }
          })
          .catch(err => {
            console.error('[SW] Error checking notifications:', err);
          });
      };
      
      // Check every 5 seconds (very aggressive)
      let checkCount = 0;
      const maxChecks = RINGTONE_DURATION / 5000; // Check for entire ringtone duration
      
      const persistenceInterval = setInterval(() => {
        persistentCheck();
        checkCount++;
        if (checkCount >= maxChecks) {
          clearInterval(persistenceInterval);
          stopRingtone();
          console.log('[SW] Stopped persistence checks');
        }
      }, 5000);
      
      // Also set up one-time renotification after 10 seconds as backup
      setTimeout(() => {
        self.registration.getNotifications({ tag: notificationOptions.tag })
          .then(notifications => {
            if (notifications.length > 0) {
              // Update existing notification to keep it fresh
              notifications.forEach(notification => {
                notification.close();
              });
              self.registration.showNotification(title + ' 📞', notificationOptions.body, notificationOptions);
            }
          });
      }, 10000);
    }
    
    // Send analytics if available
    sendNotificationAnalytics('shown', callId);
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
    stopRingtone();
  }
}

function sendNotificationAnalytics(action, callId) {
  // You can add analytics tracking here
  console.log(`[SW] Analytics: notification_${action} for ${callId}`);
}

// --- Handle FCM background messages ---
messaging.onBackgroundMessage(async (payload) => {
  console.log('[SW] Received background message:', payload);
  
  try {
    const data = payload?.data || payload?.message?.data || {};
    
    // Check if this is a call notification
    if (data.callId && data.toUid === currentUid) {
      await showCallNotification(data);
    }
  } catch (error) {
    console.error('[SW] Error in onBackgroundMessage:', error);
  }
});

// --- Handle push events ---
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
    
    const data = payload?.data || payload?.message?.data || {};
    
    // If we have a call notification, show it
    if (data.callId) {
      await showCallNotification(data);
    }
  })());
});

// --- Handle notification clicks ---
self.addEventListener("notificationclick", (event) => {
  console.log('[SW] Notification clicked:', event.notification?.data);
  
  event.notification.close();
  
  const data = event.notification?.data || {};
  const action = event.action;
  
  // Handle different actions
  if (action === 'answer') {
    // User clicked "Answer"
    handleAnswerAction(data);
  } else if (action === 'decline') {
    // User clicked "Decline"
    handleDeclineAction(data);
  } else {
    // User clicked the notification body
    handleDefaultClick(data);
  }
});

function handleAnswerAction(data) {
  // Stop ringtone when answering
  stopRingtone();
  
  const url = buildUrlWithParams('/easosunov/webrtc.html', {
    callId: data.callId,
    roomId: data.roomId,
    action: 'answer',
    autoJoin: 'true'
  });
  
  openOrFocusWindow(url);
  
  // Mark call as answered via notification
  if (data.callId) {
    firestore.collection('calls').doc(data.callId).update({
      answeredVia: 'notification',
      answeredAtMs: Date.now()
    }).catch(console.error);
  }
}

function handleDeclineAction(data) {
  // Stop ringtone when declining
  stopRingtone();
  
  // Mark call as declined
  if (data.callId) {
    firestore.collection('calls').doc(data.callId).update({
      status: 'declined',
      declinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      declinedVia: 'notification'
    }).catch(console.error);
  }
  
  // Show a confirmation if possible
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

// --- Service worker lifecycle events ---
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  
  // Skip waiting to activate immediately
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
  
  event.waitUntil(
    Promise.all([
      // Take control of all clients
      self.clients.claim(),
      
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== 'webrtc-v1') {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// --- Periodic sync for Android background (if supported) ---
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-calls') {
      console.log('[SW] Periodic sync triggered');
      
      if (currentUid) {
        // Refresh the Firestore listener
        startFirestoreListener(currentUid);
      }
    }
  });
}

// Clean up on service worker shutdown
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'STOP_RINGTONE') {
    stopRingtone();
  }
});

// Also stop ringtone when page is closed/refreshed
self.addEventListener('activate', (event) => {
  // Stop any lingering ringtones
  stopRingtone();
});

console.log('[SW] Enhanced Service Worker loaded with Android support');
