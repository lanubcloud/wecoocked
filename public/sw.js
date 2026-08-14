/*
 * Service worker: guarda el juego en el dispositivo.
 *
 * Solo cachea lo estatico (HTML, CSS, JS, iconos). El trafico de la partida
 * va por WebSocket y NUNCA pasa por aqui: interceptarlo romperia el juego.
 *
 * Al desplegar hay que subir CACHE junto con el ?v= de index.html; asi el
 * navegador se trae los archivos nuevos y tira los viejos.
 */
const CACHE = 'wecoocked-v30';

const ESTATICOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=30',
  './js/net.js?v=30',
  './js/input.js?v=30',
  './js/voice.js?v=30',
  './js/render.js?v=30',
  './js/ui.js?v=30',
  './js/main.js?v=30',
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

  const guarda = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
    }
    return res;
  };

  // El HTML va a RED PRIMERO. Es la pagina la que dice que version de cada
  // archivo tocan (los ?v=), asi que si se sirve de cache el movil se queda
  // pidiendo la version vieja y no ve los cambios hasta la segunda recarga,
  // que es justo lo que estaba pasando. Pesa 20 KB y solo se pide al abrir;
  // si no hay red, tira de la copia guardada y el juego sigue abriendo.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(fetch(req).then(guarda).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
    return;
  }

  // Todo lo demas, cache primero: es lo que evita volver a descargar y
  // reprocesar en cada partida. Lleva ?v= en la URL, asi que una version
  // nueva es una entrada nueva y nunca se sirve la vieja por error.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then(guarda).catch(() => caches.match('./index.html')))
  );
});
