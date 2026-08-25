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
  // ⚠️ BUG TROUVÉ le 2026-08-19 : `fetch(req)` tout seul respecte l'en-tête
  // `Cache-Control` envoyé par GitHub Pages (max-age=600, vérifié en réel) —
  // le navigateur répond alors depuis SON PROPRE cache disque sans repasser
  // par le réseau, malgré le "network-first" : un correctif tout juste déployé
  // restait invisible jusqu'à 10 MINUTES après un rechargement normal, PWA
  // installée sur iPhone comprise. `cache:'no-store'` force une vraie requête
  // réseau à chaque fois, en ignorant cet en-tête — c'est NOTRE cache (via
  // caches.open/c.put juste en dessous) qui sert de secours hors-ligne, pas
  // celui du navigateur.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    e.respondWith((async function () {
      try {
        const net = await fetch(req, { cache: 'no-store' });
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
    if (cached) {
      // `n` n'est pas rendu a la page : pas de clone necessaire ici.
      fetch(req).then(function (n) {
        caches.open(CACHE).then(function (c) { c.put(req, n).catch(function () {}); })
          .catch(function () {});
      }).catch(function () {});
      return cached;
    }
    try {
      const net = await fetch(req);
      // Cloner AVANT de rendre la reponse. `net.clone()` etait appele dans le
      // then de caches.open, donc une microtache PLUS TARD -- si la page avait
      // deja commence a lire le corps, clone() levait une TypeError. Cette
      // promesse n'ayant aucun catch, l'echec etait totalement silencieux et
      // l'asset n'entrait jamais dans le cache hors-ligne.
      const copie = net.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copie).catch(function () {}); })
        .catch(function () {});
      return net;
    }
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
