/* firebase-messaging-sw.js (MUST be at site root) */

importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

// Same config as your page:
firebase.initializeApp({
  apiKey:"AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain:"easosunov-webrtc.firebaseapp.com",
  projectId:"easosunov-webrtc",
  storageBucket:"easosunov-webrtc.firebasestorage.app",
  messagingSenderId:"100169991412",
  appId:"1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const messaging = firebase.messaging();

// Background notifications
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Incoming call";
  const body  = payload?.notification?.body  || "Tap to answer";
  const roomId = payload?.data?.roomId || "";

  self.registration.showNotification(title, {
    body,
    icon: payload?.notification?.icon || "/icon-192.png",
    data: { roomId }
  });
});

// Click: open app and pass roomId in URL hash
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification?.data?.roomId || "";
  event.waitUntil((async () => {
    const url = roomId ? (`/webrtc.html#${roomId}`) : "/webrtc.html";
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    return clients.openWindow(url);
  })());
});

