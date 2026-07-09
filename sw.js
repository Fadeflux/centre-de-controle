/* Service worker du centre de contrôle — reçoit les notifications push. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  var title = d.title || 'Centre de contrôle';
  var body = d.body || '';
  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: 'cc-alert'
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
