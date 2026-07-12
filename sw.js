/* Service worker du centre de contrôle — push + cache hors-ligne. */
const CACHE = 'cc-noctra-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const ks = await caches.keys();
    await Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // laisser passer les appels API (cross-origin)
  // HTML : network-first (évite les vieilles versions), repli cache si hors-ligne.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    e.respondWith((async function () {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE); c.put('./index.html', net.clone()).catch(function () {});
        return net;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  // Assets : cache-first + mise à jour en fond.
  e.respondWith((async function () {
    const cached = await caches.match(req);
    if (cached) { fetch(req).then(function (n) { caches.open(CACHE).then(function (c) { c.put(req, n).catch(function () {}); }); }).catch(function () {}); return cached; }
    try { const net = await fetch(req); caches.open(CACHE).then(function (c) { c.put(req, net.clone()).catch(function () {}); }); return net; }
    catch (err) { return Response.error(); }
  })());
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  var title = d.title || 'Centre de contrôle';
  var body = d.body || '';
  e.waitUntil(self.registration.showNotification(title, { body: body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'cc-alert' }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
