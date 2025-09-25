/* eslint-disable no-restricted-globals */
// 版本号每次上线改一下，确保用户拿到最新缓存
const SW_VERSION = 'v1.0.2';
const CACHE_NAME = `tank-game-${SW_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    // 跳过等待，尽快激活新 SW
    await self.skipWaiting();
  })());
});

// 激活：清理旧缓存并接管页面
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n !== CACHE_NAME ? caches.delete(n) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// 请求拦截：HTML 走 Network-first，其它走 Cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 仅处理同源 GET
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // HTML：优先网络、失败则缓存回退（避免离线打不开）
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('./index.html');
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' }});
      }
    })());
    return;
  }

  // 其它静态资源：缓存优先，网络兜底并更新缓存
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});

// 可选：后台消息或通知
// self.addEventListener('push', (e)=>{ ... });


