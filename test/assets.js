'use strict';
/*
 * Comprobaciones sobre los archivos del cliente. No hay navegador aqui, asi
 * que se validan por contenido: son fallos que solo se ven en el movil del
 * jugador y ahi ya es tarde.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const html = leer('public/index.html');
const sw = leer('public/sw.js');

// --- 1. la version de los assets es unica y el service worker sirve esa misma
const vHtml = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]))];
ok(vHtml.length === 1, `index.html usa una sola version de assets (${vHtml.join(',')})`);
const vSw = [...new Set([...sw.matchAll(/\?v=(\d+)/g)].map((m) => m[1]))];
ok(vSw.length === 1 && vSw[0] === vHtml[0],
   `sw.js precachea la misma version que index.html (${vSw.join(',')})`);
const cache = (sw.match(/CACHE\s*=\s*'([^']+)'/) || [])[1];
ok(!!cache && cache.endsWith(vHtml[0]),
   `el nombre de cache incluye la version (${cache}): sin esto el movil se queda con el juego viejo`);

// --- 2. el service worker no debe tocar el trafico de la partida
ok(/socket\.io/.test(sw), 'sw.js excluye /socket.io/ del cacheado');

// --- 3. todo lo que precachea el sw existe en disco
const faltan = [...sw.matchAll(/'\.\/([^']+)'/g)]
  .map((m) => m[1].split('?')[0])
  .filter((f) => f && !fs.existsSync(path.join(ROOT, 'public', f)));
ok(faltan.length === 0, 'todos los archivos precacheados existen ' + JSON.stringify(faltan));

// --- 4. el manifest apunta a iconos reales y con cabecera PNG valida
const man = JSON.parse(leer('public/manifest.webmanifest'));
let iconosOk = true;
for (const ic of man.icons) {
  const p = path.join(ROOT, 'public', ic.src);
  if (!fs.existsSync(p)) { iconosOk = false; break; }
  const b = fs.readFileSync(p);
  if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') { iconosOk = false; break; }
  const w = b.readUInt32BE(16);
  if (String(w) !== ic.sizes.split('x')[0]) { iconosOk = false; break; }
}
ok(iconosOk, 'los iconos del manifest existen, son PNG y miden lo que declaran');
ok(man.icons.some((i) => i.purpose === 'maskable'),
   'hay un icono maskable (si no, Android lo recorta mal al instalarlo)');

// --- 5. el fondo estatico se cachea: la senal es que exista buildStatic y que
//        el bucle de dibujo copie el lienzo en vez de repintar el suelo
const render = leer('public/js/render.js');
ok(/buildStatic\s*\(/.test(render), 'render.js cachea el fondo en un lienzo aparte');
ok(/drawImage\(this\.bg/.test(render), 'el bucle copia ese lienzo en vez de repintar el comedor y el suelo');
ok(/Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(render),
   'la densidad de pixeles esta topada a 2x');

// --- 6. el HUD se ancla al juego, no al borde del dispositivo
const css = leer('public/css/style.css');
ok(/--game-play-top/.test(css) && /--game-play-top/.test(render),
   'el HUD se posiciona con la altura real de la cocina (arreglo de la tablet)');

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
