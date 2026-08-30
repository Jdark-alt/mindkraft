// ── Mindkraft Service Worker ──────────────────────────────────────────────
// Strategy:
//   - App shell (HTML/CSS/JS) → Cache First, fallback to network
//   - Firebase & external URLs → Network only (never cache auth/db calls)
//   - Google Fonts → Cache First (they're immutable once fetched)
//
// Bump CACHE_VERSION whenever you deploy a meaningful update.
// This causes the old cache to be deleted and the new one installed.

const CACHE_VERSION = 'v181';
const CACHE_NAME = 'mindkraft-shell-' + CACHE_VERSION;

// Files that make up the app shell — must all load for the app to work
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.svg',
    './privacy.html',
    './terms.html'
];

// ── Install: cache the app shell ─────────────────────────────────────────
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            // Cache files individually so one 404 doesn't abort the whole install
            return Promise.all(
                APP_SHELL.map(function(url) {
                    return cache.add(url).catch(function(err) {
                        console.warn('[SW] Failed to cache', url, err);
                    });
                })
            );
        }).then(function() {
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

// ── Background revalidation throttle ──────────────────────────────────────
// Decides whether a cache hit is stale enough to be worth re-fetching in the
// background, so a cached asset isn't re-downloaded on every single request.
//
// Freshness comes from the cached response's own Date header, which survives
// the browser terminating and restarting this worker — a purely in-memory
// timestamp would reset on every restart and refetch the whole shell again on
// the next app open, which is most of what we are trying to avoid. The
// in-memory map is only a fallback for responses served without a Date.
//
// One hour is well inside the window where a real deploy would have bumped
// CACHE_VERSION, which rebuilds the cache from the network outright.
var REVALIDATE_MS = 60 * 60 * 1000;
var lastRevalidated = Object.create(null);

function shouldRevalidate(url, cachedResponse) {
    var now = Date.now();

    var dateHeader = cachedResponse && cachedResponse.headers.get('date');
    if (dateHeader) {
        var cachedAt = Date.parse(dateHeader);
        if (!isNaN(cachedAt)) return (now - cachedAt) >= REVALIDATE_MS;
    }

    // No usable Date header — fall back to a per-worker-lifetime throttle.
    var last = lastRevalidated[url];
    if (last && (now - last) < REVALIDATE_MS) return false;
    lastRevalidated[url] = now;
    return true;
}

// ── Fetch: routing logic ──────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // Only GETs are cacheable; passing anything else through avoids a
    // pointless cache lookup on every POST/PUT the app makes.
    if (event.request.method !== 'GET') return;

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

    // Google Fonts and Phosphor Icons — cache first.
    //
    // Both are pinned to a version in the URL, so a cached copy can never go
    // stale: a different version is a different URL. Phosphor belongs here and
    // not in APP_SHELL because the icon fonts are only fetched once a glyph is
    // actually painted, so pre-caching them would download weights the first
    // screen may never use. Caching on first paint instead means the icons
    // survive going offline, which for a PWA is the difference between a
    // working UI and a page full of blank squares.
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com') ||
        url.includes('unpkg.com/@phosphor-icons')) {
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

    // App shell — cache first, with a THROTTLED background revalidation.
    //
    // The previous version re-fetched every cached asset on every request.
    // The shell is ~1.9 MB (app.js + style.css + index.html), so each app
    // open quietly re-downloaded all of it in the background — burning mobile
    // data, and competing with Firestore for bandwidth and with the render for
    // main-thread time at exactly the moment the app is trying to start up.
    //
    // A cached asset is now revalidated at most once per REVALIDATE_MS per
    // URL. Correctness is unaffected: a real deploy bumps CACHE_VERSION, which
    // builds a fresh cache from the network in the install handler.
    event.respondWith(
        caches.match(event.request).then(function(cached) {
            if (cached) {
                if (shouldRevalidate(url, cached)) {
                    // Background refresh — update cache silently, never block the response
                    fetch(event.request).then(function(networkResponse) {
                        if (networkResponse && networkResponse.status === 200) {
                            caches.open(CACHE_NAME).then(function(cache) {
                                cache.put(event.request, networkResponse.clone());
                            });
                        }
                    }).catch(function() {
                        // Network unavailable — cached copy is already serving the page, no action needed
                    });
                }
                return cached;
            }
            // Not in cache — fetch from network, fail silently if offline
            return fetch(event.request).catch(function(err) {
                // Network unavailable and nothing cached — return minimal offline response
                // Only log non-beacon/analytics failures to avoid console noise
                if (!event.request.url.includes('beacon') &&
                    !event.request.url.includes('analytics') &&
                    !event.request.url.includes('cleardot')) {
                    console.warn('[SW] Fetch failed (offline?):', event.request.url);
                }
                return new Response('', { status: 503, statusText: 'Offline' });
            });
        })
    );
});

// ── Push Notifications ────────────────────────────────────────────────────
// Fired via Web Push (VAPID) by the sendDueReminders Cloud Function. Works
// even when the browser tab is closed (browser must still be running).
//
// Payloads carry a `data` object identifying the reminder:
//   { type: 'general'|'activity', activityId: string|null }
// which notificationclick below uses to deep-link to the right activity.
// Older payloads have no `data` and still work — they fall through as general.
self.addEventListener('push', function(event) {
    var data = {};
    try { data = event.data ? event.data.json() : {}; } catch(e) {}

    var payload = data.data || {};
    var title   = data.title || 'Mindkraft';
    var options = {
        body:      data.body  || "Don't forget to check off today's tasks!",
        icon:      './icon-192.svg',
        badge:     './icon-192.svg',
        // Per-activity tags so two activity reminders due at the same minute
        // don't silently replace one another. The general reminder keeps its
        // original tag, so it still collapses onto itself as before.
        tag:       data.tag || 'mindkraft-daily-reminder',
        renotify:  false,
        vibrate:   [200, 100, 200],
        data:      { type: payload.type || 'general', activityId: payload.activityId || null,
                     modeKind: payload.modeKind || null }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens / focuses the app, and jumps to the activity
// when the reminder was for a specific one.
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    var payload = event.notification.data || {};
    var activityId = payload.activityId || null;
    // Gift and friend pushes carry no activity — both belong on the People
    // tab, which is where gifts land and where an incoming friend request is
    // answered, so they share one destination rather than two.
    var social = payload.type === 'gift' || payload.type === 'friend';
    // Pact and Versus pushes belong on the Modes page — Versus because the
    // Challenges surface hangs off it, Pact because that is where the mode
    // itself lives. A habit reminder is a mode push too, but it names an
    // activity, so it keeps the activity deep link — being taken to the thing
    // you are meant to do beats being taken to the page that says so.
    var modes = payload.type === 'pact' || payload.type === 'versus' ||
                (payload.type === 'mode' && !activityId);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
            for (var i = 0; i < list.length; i++) {
                var client = list[i];
                if ('focus' in client) {
                    // App is already open — tell it where to go, then focus.
                    // postMessage rather than a URL change so we don't reload
                    // and lose in-memory state.
                    if ((activityId || social || modes) && client.postMessage) {
                        try {
                            client.postMessage({
                                type: social ? 'mindkraft-gift-click'
                                    : modes  ? 'mindkraft-modes-click'
                                             : 'mindkraft-notification-click',
                                activityId: activityId
                            });
                        } catch (e) { /* focus alone is still useful */ }
                    }
                    return client.focus();
                }
            }
            // Cold start — carry the target in the URL for the app to pick up.
            if (clients.openWindow) {
                if (social) return clients.openWindow('./?tab=friends');
                if (modes) return clients.openWindow('./?tab=modes');
                return clients.openWindow(activityId ? './?reminder=' + encodeURIComponent(activityId) : './');
            }
        })
    );
});
