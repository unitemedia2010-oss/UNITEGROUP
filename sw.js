const CACHE_NAME = "unite-hr-portal-v40.1";
const APP_SHELL = [
  "./", "./index.html", "./portal.html", "./admin.html", "./employee.html", "./change-password.html",
  "./css/app.css?v=41", "./css/v35.css?v=35", "./css/v36.css?v=36", "./css/v37.css?v=38", "./css/v39.css?v=39", "./css/v40.css?v=44",
  "./js/config.js?v=40", "./js/auth.js?v=35", "./js/portal.js?v=43", "./js/import-mapper.js?v=40",
  "./js/admin.js?v=35", "./js/employee.js?v=35", "./js/first-password.js?v=35",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/unite-gold.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match("./portal.html"))));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification?.data?.url || "./portal.html";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.includes("portal.html"));
    if (existing) {
      existing.navigate?.(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});

self.addEventListener("push", event => {
  let payload = { title: "Unite HR Portal", body: "Bạn có thông báo mới." };
  try { payload = { ...payload, ...(event.data?.json?.() || {}) }; } catch {
    try { payload.body = event.data?.text?.() || payload.body; } catch {}
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
    data: { url: payload.url || "./portal.html" }
  }));
});
