// Guarda o app no aparelho para abrir sem internet (obra sem sinal).
// Ao publicar uma versão nova, aumente o número abaixo.
const VERSION = 'vrs-v2';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'lib/jspdf.umd.min.js',
  'fonts/archivo-latin-400-normal.woff2', 'fonts/archivo-latin-500-normal.woff2', 'fonts/archivo-latin-600-normal.woff2',
  'fonts/archivo-latin-700-normal.woff2', 'fonts/archivo-latin-800-normal.woff2',
  'assets/logo-vistoria-rs.png', 'assets/logo-vistoria-rs-branco.png', 'assets/selo-vistoria-rs.png', 'assets/logo-cw-branco.png',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Google/Drive vão direto para a rede
  // app: rede primeiro (pega atualização), cache se estiver sem internet
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
