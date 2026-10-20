/* Cache strategy, deliberately split:
   - the app shell (html/js/css/manifest) is NETWORK FIRST, so a deploy
     lands on the next launch instead of being pinned to an old cache
   - the dictionary and stroke data are CACHE FIRST, since they're 7MB
     and change rarely
   Bump V whenever the precache list changes. */
const V = 'hanzi-v9';
const SHELL = ['./','./index.html','./styles.css','./app.js','./data/my-own.js','./songs.js','./manifest.webmanifest'];
const DATA  = ['./data/notes.json','./data/hsk.json','./data/cedict.txt','./vendor/opencc.js',
  './data/strokes-0.json','./data/strokes-1.json','./data/strokes-2.json','./data/strokes-3.json',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all([...SHELL, ...DATA].map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

// vendor/ and data/ hold big libraries — cache-first, never re-fetched on every launch
const isShell = url =>
  url.origin === location.origin &&
  !/\/(vendor|data)\//.test(url.pathname) &&
  /\.(html|js|css|webmanifest)$|\/$/.test(url.pathname);

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);

  // navigations and app code: try the network, fall back to cache offline
  if (r.mode === 'navigate' || isShell(url)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(r, { cache: 'no-store' });
        if (res && res.ok) {
          const c = await caches.open(V); c.put(r, res.clone());
        }
        return res;
      } catch (err) {
        return (await caches.match(r, { ignoreSearch: true }))
            || (await caches.match('./index.html'))
            || Response.error();
      }
    })());
    return;
  }

  // everything else: cache first, then network, caching what comes back
  e.respondWith((async () => {
    const hit = await caches.match(r, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(r);
      if (res && res.ok &&
          (url.origin === location.origin ||
           url.hostname.endsWith('gstatic.com') ||
           url.hostname.endsWith('googleapis.com'))) {
        const c = await caches.open(V); c.put(r, res.clone());
      }
      return res;
    } catch (err) {
      // only a page load should fall back to the app; a failed data or
      // library fetch must fail, not come back as HTML
      return Response.error();
    }
  })());
});
