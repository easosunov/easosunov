// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain: "easosunov-webrtc.firebaseapp.com",
  projectId: "easosunov-webrtc",
  storageBucket: "easosunov-webrtc.firebasestorage.app",
  messagingSenderId: "100169991412",
  appId: "1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const messaging = firebase.messaging();

// Function to detect Android in service worker
function isAndroidInSW() {
  return /Android/i.test(self.navigator.userAgent);
}

// Function to detect iOS in service worker
function isIOSInSW() {
  return /iPhone|iPad|iPod/i.test(self.navigator.userAgent);
}

// Function to detect mobile in service worker
function isMobileInSW() {
  return isAndroidInSW() || isIOSInSW();
}

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Received background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'Incoming Call';
  const notificationBody = payload.notification?.body || 'You have an incoming call';
  const data = payload.data || {};
  
  // Platform-specific notification options
  const notificationOptions = {
    body: notificationBody,
    icon: '/easosunov/icon-192x192.png', // Make sure this icon exists
    badge: '/easosunov/icon-96x96.png',
    tag: `webrtc-call-${data.callId || 'unknown'}`,
    renotify: true,
    requireInteraction: isAndroidInSW(), // PERSISTENT on Android
    data: data,
    actions: [
      {
        action: 'answer',
        title: 'Answer',
        icon: '/easosunov/answer-icon.png'
      },
      {
        action: 'decline',
        title: 'Decline',
        icon: '/easosunov/decline-icon.png'
      }
    ]
  };
  
  // Add vibration for Android
  if (isAndroidInSW()) {
    notificationOptions.vibrate = [200, 100, 200, 100, 200, 100, 400];
  }
  
  // Show notification
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification);
  
  const data = event.notification.data || {};
  const action = event.action;
  
  event.notification.close();
  
  if (action === 'answer') {
    // User clicked "Answer"
    const url = `/easosunov/index.html?callId=${data.callId}&roomId=${data.roomId}&fromName=${encodeURIComponent(data.fromName || '')}&action=answer`;
    event.waitUntil(
      clients.openWindow(url)
    );
  } else if (action === 'decline') {
    // User clicked "Decline"
    const url = `/easosunov/index.html?callId=${data.callId}&roomId=${data.roomId}&fromName=${encodeURIComponent(data.fromName || '')}&action=decline`;
    event.waitUntil(
      clients.openWindow(url)
    );
  } else {
    // User clicked notification body
    const url = `/easosunov/index.html?callId=${data.callId}&roomId=${data.roomId}&fromName=${encodeURIComponent(data.fromName || '')}`;
    event.waitUntil(
      clients.openWindow(url)
    );
  }
  
  // Send message to all clients
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({
          type: 'NOTIFICATION_CLICKED',
          callId: data.callId,
          roomId: data.roomId,
          fromName: data.fromName
        });
      }
    })
  );
});

// Handle push subscription
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed:', event);
  
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'BCR4B8uf0WzUuzHKlBCJO22NNnnupe88j8wkjrTwwQALDpWUeJ3umtIkNJTrLb0I_LeIeu2HyBNbogHc6Y7jNzM'
    }).then((subscription) => {
      console.log('[SW] New subscription:', subscription);
      // You might want to send the new subscription to your server here
    })
  );
});
