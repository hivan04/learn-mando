const V='hanzi-v5';
const CORE=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest',
  './data/notes.json','./data/hsk.json',
  './data/strokes-0.json','./data/strokes-1.json','./data/strokes-2.json','./data/strokes-3.json',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-180.png'];

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(V);
    // add individually so one failure doesn't abort the whole install
    await Promise.all(CORE.map(u=>c.add(u).catch(()=>{})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k!==V) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET') return;
  const url=new URL(r.url);
  // navigations: network first, fall back to cached shell
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).catch(()=>caches.match('./index.html')));
    return;
  }
  // everything else: cache first, then network, and cache what comes back
  e.respondWith((async()=>{
    const hit=await caches.match(r,{ignoreSearch:true});
    if(hit) return hit;
    try{
      const res=await fetch(r);
      if(res.ok && (url.origin===location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com'))){
        const c=await caches.open(V); c.put(r,res.clone());
      }
      return res;
    }catch(err){
      return caches.match('./index.html');
    }
  })());
});
