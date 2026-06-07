const CACHE_NAME = 'music-player-v2'; // 🚀 Increment this version number whenever you deploy updates!
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    // 🚀 CRITICAL: Forces the waiting service worker to become the active service worker immediately
    self.skipWaiting(); 
});

// Activate Event (Cleans up old cache layers automatically)
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('Removing old cache store:', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    // Forces absolute synchronization across all open browser tabs
    return self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            return cachedResponse || fetch(e.request);
        })
    );
});