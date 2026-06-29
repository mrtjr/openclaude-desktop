// ─── Service worker da PWA OpenClaude — v2.191.0 ──────────────────────────
// Precarrega a "casca" (shell) p/ o app abrir mesmo offline e instalar na tela
// de início. Estratégia: network-first p/ a casca (pega atualizações), com
// fallback ao cache quando sem rede. NUNCA cacheia /api (chat é sempre ao vivo).

const CACHE = 'oc-pwa-v5'
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Chat/health/info são sempre ao vivo — não passa pelo cache.
  if (url.pathname.startsWith('/api/')) return
  if (e.request.method !== 'GET') return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  )
})
