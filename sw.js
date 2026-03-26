// ── LevelUp Service Worker ────────────────────────────────────────────────
// Strategy:
//   - App shell (HTML/CSS/JS) → Cache First, fallback to network
//   - Firebase & external URLs → Network only (never cache auth/db calls)
//   - Google Fonts → Cache First (they're immutable once fetched)
//
// Bump CACHE_VERSION whenever you deploy a meaningful update.
// This causes the old cache to be deleted and the new one installed.

const CACHE_VERSION = 'v31';
const CACHE_NAME = 'mindkraft-shell-' + CACHE_VERSION;

// Files that make up the app shell — must all load for the app to work
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.svg',
    './icon-512.svg'
];

// ── Install: cache the app shell ─────────────────────────────────────────
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(APP_SHELL);
        }).then(function() {
            // Activate immediately — don't wait for old SW to go idle
            return self.skipWaiting();
        })
    );
});

// ── Activate: delete old caches ──────────────────────────────────────────
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(key) {
                    return key.startsWith('mindkraft-shell-') && key !== CACHE_NAME;
                }).map(function(key) {
                    return caches.delete(key);
                })
            );
        }).then(function() {
            // Take control of all open clients immediately
            return self.clients.claim();
        })
    );
});

// ── Fetch: routing logic ──────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // Never intercept Firebase or Google auth/api calls
    if (
        url.includes('firestore.googleapis.com') ||
        url.includes('firebase.googleapis.com') ||
        url.includes('identitytoolkit.googleapis.com') ||
        url.includes('securetoken.googleapis.com') ||
        url.includes('gstatic.com/firebasejs') ||
        url.includes('accounts.google.com')
    ) {
        return; // Let browser handle Firebase directly
    }

    // Google Fonts — cache first (they're versioned and immutable)
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request).then(function(cached) {
                if (cached) return cached;
                return fetch(event.request).then(function(response) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                    return response;
                });
            })
        );
        return;
    }

    // App shell — cache first, fallback to network
    event.respondWith(
        caches.match(event.request).then(function(cached) {
            if (cached) {
                // Serve from cache immediately, then refresh cache in background
                var fetchPromise = fetch(event.request).then(function(networkResponse) {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                }).catch(function() {
                    // Network failed — cached version was already returned
                });
                return cached;
            }
            // Not in cache — fetch from network
            return fetch(event.request);
        })
    );
});

// ── Push Notifications ────────────────────────────────────────────────────
// Fired by GitHub Actions via Web Push when the user has a reminder set.
// Works even when the browser tab is closed (browser must still be running).
self.addEventListener('push', function(event) {
    var data = {};
    try { data = event.data ? event.data.json() : {}; } catch(e) {}

    var title   = data.title || 'Mindkraft ⚔️';
    var options = {
        body:      data.body  || "Don't forget to check off today's tasks!",
        icon:      './icon-192.svg',
        badge:     './icon-192.svg',
        tag:       'mindkraft-daily-reminder', // replaces previous notification instead of stacking
        renotify:  false,
        vibrate:   [200, 100, 200]
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens / focuses the app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
            for (var i = 0; i < list.length; i++) {
                if ('focus' in list[i]) return list[i].focus();
            }
            if (clients.openWindow) return clients.openWindow('./');
        })
    );
});
