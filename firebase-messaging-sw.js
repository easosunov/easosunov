/* firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:"AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
  authDomain:"easosunov-webrtc.firebaseapp.com",
  projectId:"easosunov-webrtc",
  storageBucket:"easosunov-webrtc.firebasestorage.app",
  messagingSenderId:"100169991412",
  appId:"1:100169991412:web:27ef6820f9a59add6b4aa1"
});

const messaging = firebase.messaging();

// This fires when the tab is CLOSED but browser is running
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Incoming call";
  const options = {
    body: payload?.notification?.body || "Tap to open",
    data: payload?.data || {}
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};

  const url = new URL("/easosunov/webrtc.html", self.location.origin);


  if (d.callId) url.searchParams.set("callId", d.callId);
  if (d.roomId) url.searchParams.set("roomId", d.roomId);
  if (d.fromPhone) url.searchParams.set("fromPhone", d.fromPhone);
  if (d.toPhone) url.searchParams.set("toPhone", d.toPhone);

  event.waitUntil(clients.openWindow(url.toString()));
});
