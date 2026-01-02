/* firebase-messaging-sw.js */
(function () {
  function log(msg) {
    try { console.log("[FCM-SW]", msg); } catch (e) {}
  }

  try {
    importScripts("/easosunov/firebase-app-compat.js");
    importScripts("/easosunov/firebase-messaging-compat.js");
    log("importScripts OK");
  } catch (e) {
    console.error("[FCM-SW] importScripts FAILED", e);
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

  messaging.onBackgroundMessage(function (payload) {
    payload = payload || {};
    var notif = payload.notification || {};
    var title = notif.title || "Incoming call";
    var options = {
      body: notif.body || "Tap to answer",
      data: payload.data || {},
      // optional icon:
      // icon: "/easosunov/icon-192.png"
    };
    self.registration.showNotification(title, options);
  });

  self.addEventListener("notificationclick", function (event) {
    event.notification.close();

    var d = (event.notification && event.notification.data) ? event.notification.data : {};
    var url = new URL("/easosunov/webrtc.html", self.location.origin);

    // Prefer inviteId/callId, but keep your existing fields too
    if (d.inviteId) url.searchParams.set("inviteId", d.inviteId);
    if (d.callId) url.searchParams.set("callId", d.callId);
    if (d.roomId) url.searchParams.set("roomId", d.roomId);
    if (d.fromPhone) url.searchParams.set("fromPhone", d.fromPhone);
    if (d.toPhone) url.searchParams.set("toPhone", d.toPhone);

    // Let webrtc.html know this came from a notification
    url.searchParams.set("autojoin", "1");

    event.waitUntil((async function () {
      // Focus an existing tab if it's already open
      var allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (var i = 0; i < allClients.length; i++) {
        var c = allClients[i];
        try {
          if (c && "focus" in c) {
            await c.focus();
            if ("navigate" in c) await c.navigate(url.toString());
            return;
          }
        } catch (e) {}
      }
      // Otherwise open a new one
      return clients.openWindow(url.toString());
    })());
  });
})();
