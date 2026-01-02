/* firebase-messaging-sw.js */

(function () {
  // Make SW failures visible in DevTools (Application -> Service Workers -> inspect)
  function log(msg) {
    try { console.log("[FCM-SW]", msg); } catch (e) {}
  }

  try {
    importScripts("/easosunov/firebase-app-compat.js");
    importScripts("/easosunov/firebase-messaging-compat.js");
    log("importScripts OK");
  } catch (e) {
    log("importScripts FAILED: " + (e && e.message ? e.message : e));
    // Re-throw so registration fails, but now you can see WHY in the SW console.
    throw e;
  }

  try {
    firebase.initializeApp({
      apiKey: "AIzaSyAg6TXwgejbPAyuEPEBqW9eHaZyLV4Wq98",
      authDomain: "easosunov-webrtc.firebaseapp.com",
      projectId: "easosunov-webrtc",
      storageBucket: "easosunov-webrtc.firebasestorage.app",
      messagingSenderId: "100169991412",
      appId: "1:100169991412:web:27ef6820f9a59add6b4aa1"
    });
    log("firebase.initializeApp OK");
  } catch (e) {
    log("firebase.initializeApp FAILED: " + (e && e.message ? e.message : e));
    throw e;
  }

  let messaging;
  try {
    messaging = firebase.messaging();
    log("firebase.messaging() OK");
  } catch (e) {
    log("firebase.messaging() FAILED: " + (e && e.message ? e.message : e));
    throw e;
  }

  // Background handler (avoid optional chaining just in case)
  messaging.onBackgroundMessage(function (payload) {
    payload = payload || {};
    var notif = payload.notification || {};
    var title = notif.title || "Incoming call";
    var options = {
      body: notif.body || "Tap to open",
      data: payload.data || {}
    };
    self.registration.showNotification(title, options);
  });

  self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    var d = (event.notification && event.notification.data) ? event.notification.data : {};
    var url = new URL("/easosunov/webrtc.html", self.location.origin);

    if (d.callId) url.searchParams.set("callId", d.callId);
    if (d.roomId) url.searchParams.set("roomId", d.roomId);
    if (d.fromPhone) url.searchParams.set("fromPhone", d.fromPhone);
    if (d.toPhone) url.searchParams.set("toPhone", d.toPhone);

    event.waitUntil(clients.openWindow(url.toString()));
  });
})();
