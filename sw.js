/* sw.js
 *
 * Offline shell for Bromigos HQ.
 *
 * The whole risk of a service worker is serving yesterday's app forever, so the
 * strategy is deliberately conservative:
 *
 *   the page and the data  network first, cache only as a fallback
 *   fonts and icons        cache first, they never change under the same name
 *
 * That means being online always shows current data, and being offline shows
 * the last thing you saw rather than a browser error. The cache name carries a
 * version; bumping it drops everything from the previous one on activate.
 */

const VERSION = "bromigos-v1";
const SHELL = [
  "./",
  "./index.html",
  "./img/icon-192.png",
  "./img/apple-touch-icon.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", e => {
  // A missing file must not abort the whole install, so they are added one by
  // one rather than through addAll, which rejects the lot if any single one 404s.
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com");
  const isAsset = sameOrigin && /\.(png|svg|ico|webp)$/.test(url.pathname);

  /* things that never change under the same name */
  if (isFont || isAsset) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) (await caches.open(VERSION)).put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  if (!sameOrigin) return;

  /* the page and the league data: always prefer the network */
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
