const CACHE_NAME = 'inertia-pos-v3';
const urlsToCache = [
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // Skip cross-origin extensions, analytics, or third-party APIs
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only cache immutable static assets in /build/assets/ or /images/
  const isStaticAsset = url.pathname.startsWith('/build/') ||
                        url.pathname.startsWith('/images/') ||
                        url.pathname === '/favicon.ico' ||
                        url.pathname.endsWith('.png') ||
                        url.pathname.endsWith('.jpg') ||
                        url.pathname.endsWith('.svg') ||
                        url.pathname.endsWith('.woff2');

  if (!isStaticAsset) {
    // Dynamic page navigations, Inertia requests, sessions, and APIs are NEVER cached
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone).catch(() => {});
          });

          return networkResponse;
        })
        .catch(() => {
          return new Response('', { status: 404, statusText: 'Not Found' });
        });
    })
  );
});
