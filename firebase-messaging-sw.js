/* firebase-messaging-sw.js */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("[SW] push event received");

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data?.text() };
  }

  const title =
    data.notification?.title ||
    data.title ||
    "Incoming call";

  const options = {
    body:
      data.notification?.body ||
      data.body ||
      "Tap to answer",
    data: data.data || {},
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const d = event.notification.data || {};
  const url = new URL("/easosunov/webrtc.html", self.location.origin);

  if (d.callId) url.searchParams.set("callId", d.callId);
  if (d.roomId) url.searchParams.set("roomId", d.roomId);
  if (d.inviteId) url.searchParams.set("inviteId", d.inviteId);

  event.waitUntil(self.clients.openWindow(url.toString()));
});
