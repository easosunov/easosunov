// firebase-messaging-sw.js (MINIMAL TEST)
console.log("SW: boot", self.location.href);

self.addEventListener("install", (event) => {
  console.log("SW: install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("SW: activate");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // no-op
});
