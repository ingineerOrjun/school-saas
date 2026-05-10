/* Scholaris service worker — Phase 26 Section 6 scaffold.
 *
 * Deliberately MINIMAL. We do NOT cache API responses yet (the spec
 * is explicit: "scaffold the architecture safely"). What this worker
 * does today:
 *
 *   • Caches the offline fallback page (/offline) on install.
 *   • Serves the fallback when a navigation request fails (offline
 *     + uncached page).
 *   • Lets every other request pass through to the network.
 *
 * What it does NOT do:
 *   • API caching (would risk stale tenant data + cross-user leaks).
 *   • Asset caching (Next.js's own caching + the browser's HTTP
 *     cache cover the JS/CSS/font cases).
 *   • Background sync (the existing in-process sync engine handles
 *     this — we don't need the SW Background Sync API yet).
 *
 * Lifecycle:
 *   • install   → precache fallback page, skipWaiting
 *   • activate  → claim open clients so the new worker takes effect
 *                  immediately on first install
 *   • fetch     → network-first for navigations, fall back to cached
 *                  /offline only when the network call fails
 *
 * Update strategy:
 *   The cache name embeds a version. Bumping the version invalidates
 *   the previous cache. Bump on any change to /offline or this file.
 */

const VERSION = "scholaris-v1";
const FALLBACK_URLS = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        await cache.addAll(FALLBACK_URLS);
      } catch (e) {
        // The fallback page might 404 in dev when the route hasn't
        // been built yet. Don't fail the install — the worker is
        // still useful for the offline event.
        // eslint-disable-next-line no-console
        console.warn("[sw] failed to precache fallback:", e);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old cache versions.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET navigations. Everything else (API calls, JSON
  // fetches, asset requests) goes straight to the network.
  if (req.method !== "GET") return;
  if (req.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        // Network failed — serve the offline fallback.
        const cache = await caches.open(VERSION);
        const cached = await cache.match("/offline");
        if (cached) return cached;
        // Last resort — synthesize a minimal HTML response so the
        // browser doesn't show its default error.
        return new Response(
          "<!doctype html><meta charset=utf-8><title>Offline</title><h1>You're offline</h1><p>Reconnect and refresh to continue.</p>",
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
    })(),
  );
});
