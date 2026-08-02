const VOXEN_NAVIGATION_CACHE_PREFIX = 'voxen-navigation-';

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(VOXEN_NAVIGATION_CACHE_PREFIX))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      ),
  );
});

// L1 job notifications: open the path stored in notification data (or focus existing client).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification?.data?.url;
  const path = typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await client.focus();
            if ('navigate' in client && typeof client.navigate === 'function') {
              await client.navigate(path);
            }
            return;
          } catch {
            // try next client
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(path);
      }
    })(),
  );
});
