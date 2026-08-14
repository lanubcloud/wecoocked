/*
 * Service worker: guarda el juego en el dispositivo.
 *
 * Solo cachea lo estatico (HTML, CSS, JS, iconos). El trafico de la partida
 * va por WebSocket y NUNCA pasa por aqui: interceptarlo romperia el juego.
 *
 * Al desplegar hay que subir CACHE junto con el ?v= de index.html; asi el
 * navegador se trae los archivos nuevos y tira los viejos.
 */
const CACHE = 'wecoocked-v25';

const ESTATICOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=25',
  './js/net.js?v=25',
  './js/input.js?v=25',
  './js/voice.js?v=25',
  './js/render.js?v=25',
  './js/ui.js?v=25',
  './js/main.js?v=25',
  './img/icon-192.png',
  './img/icon-512.png',
];

self.addEventListener('install', (e) => {
  // addAll falla entero si un archivo da error; se piden de uno en uno para
  // que un fallo suelto no deje la instalacion a medias.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ESTATICOS.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // el juego en vivo no se cachea jamas
  if (url.pathname.startsWith('/socket.io/') || url.pathname === '/healthz') return;

  // Cache primero: es lo que evita volver a descargar y reprocesar en cada
  // partida. Si no esta, se pide a la red y se guarda para la proxima.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
