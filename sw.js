const PLANNER_CACHE = 'vchri-planner-shell-v5';
const PLANNER_ASSETS = [
  './',
  'index.html',
  'planner.html',
  'review.html',
  'contracts.html',
  'styles.css',
  'home.css',
  'review.css',
  'contracts.css',
  'manifest.webmanifest',
  'scripts/core.js',
  'scripts/data.js',
  'scripts/contracts.js',
  'scripts/features.js',
  'scripts/home.js',
  'scripts/main.js',
  'scripts/render.js',
  'scripts/review.js',
  'assets/planner-icon.svg',
  'assets/planner-badge.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PLANNER_CACHE).then(cache => cache.addAll(PLANNER_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== PLANNER_CACHE).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isDynamicShellAsset =
    event.request.mode === 'navigate' ||
    event.request.destination === 'style' ||
    event.request.destination === 'script' ||
    url.pathname.endsWith('.webmanifest');

  if (isDynamicShellAsset) {
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(PLANNER_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request) || caches.match(url.pathname.replace(/^\//, '')) || caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(PLANNER_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const fallbackUrl = data.taskId
    ? 'planner.html#task=' + encodeURIComponent(data.taskId)
    : 'planner.html';
  const targetUrl = new URL(data.url || fallbackUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          return client.focus().then(() => {
            if ('navigate' in client) return client.navigate(targetUrl);
            return client;
          });
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: 'Planner reminder', body: event.data.text() };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const taskId = data.taskId || payload.taskId || '';
  const url = data.url || payload.url || (taskId ? 'planner.html#task=' + encodeURIComponent(taskId) : 'planner.html');

  event.waitUntil(
    self.registration.showNotification(notification.title || payload.title || 'Planner reminder', {
      body: notification.body || payload.body || '',
      data: {
        ...data,
        taskId,
        url
      },
      tag: notification.tag || payload.tag || (taskId ? 'planner-reminder-' + taskId : 'planner-reminder'),
      requireInteraction: true,
      icon: 'assets/planner-icon.svg',
      badge: 'assets/planner-badge.svg'
    })
  );
});
