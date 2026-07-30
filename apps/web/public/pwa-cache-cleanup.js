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
