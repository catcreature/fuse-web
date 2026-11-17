// Fuse's service worker: offline copy of the site and system notifications. Hand-written, no Workbox.
// Bump CACHE every release so old copies are dropped.
const CACHE = 'fuse-v0.3.1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fuse-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first, so a new release shows as soon as it is online; the cached page otherwise.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Stale-while-revalidate: the cached copy now, a fresh one stored for next time.
  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => cached || Response.error());
        if (cached) {
          event.waitUntil(fresh.then(() => undefined, () => undefined));
          return cached;
        }
        return fresh;
      }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(scope));
      if (open) return open.focus();
      return self.clients.openWindow('./');
    }),
  );
});
