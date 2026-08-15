'use strict';
/*
 * El servidor no manda al cliente el mapa entero: recorta unos pocos campos.
 * Si el cliente lee uno que no viaja, no falla al arrancar ni en los tests del
 * servidor: revienta en mitad de setMap el dia que empieza una partida, y con
 * el se lleva el dibujado entero. Paso justo eso leyendo map.cells, que solo
 * existe en el servidor.
 *
 * Aqui se comparan las dos listas: lo que rooms.js envia contra lo que
 * render.js consume.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const rooms = fs.readFileSync(path.join(ROOT, 'server/rooms.js'), 'utf8');
const render = fs.readFileSync(path.join(ROOT, 'public/js/render.js'), 'utf8');

// --- lo que el servidor mete en el payload:  map: { id: ..., w: ..., ... }
const envio = rooms.match(/\bmap:\s*\{([^}]*)\}/);
ok(!!envio, 'se encuentra el payload del mapa en rooms.js');
const enviados = new Set((envio ? envio[1] : '').match(/(\w+)\s*:/g)?.map((s) => s.replace(/\s*:$/, '')) || []);
console.log('     el servidor envia: ' + [...enviados].sort().join(', '));

// --- lo que el cliente lee:  map.loQueSea  /  this.map.loQueSea
// Se quitan antes los comentarios: ahi se nombran campos para explicar cosas
// (justo este arreglo lo hace) y no son usos de verdad.
const codigo = render
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const leidos = new Set();
for (const m of codigo.matchAll(/\b(?:this\.)?map\.(\w+)/g)) leidos.add(m[1]);
console.log('     el cliente lee:    ' + [...leidos].sort().join(', '));

const fantasmas = [...leidos].filter((f) => !enviados.has(f));
ok(fantasmas.length === 0,
   'el cliente no lee campos del mapa que el servidor no manda ' + JSON.stringify(fantasmas));

// --- y que el layout, que es del que cuelga todo lo demas, viaja siempre
ok(enviados.has('layout'), 'el payload incluye layout (de el saca el cliente las casillas)');
ok(enviados.has('w') && enviados.has('h'), 'el payload incluye w y h');

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
