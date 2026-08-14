'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildMap } = require(path.join(ROOT, 'server/game/map.js'));
const { Engine } = require(path.join(ROOT, 'server/game/engine.js'));
const { DT, PREP } = require(path.join(ROOT, 'server/game/config.js'));

const map = buildMap();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// --- 1. accesibilidad: toda casilla interactiva tiene suelo adyacente
const floor = (x, y) => { const c = map.cells[y * map.w + x]; return c && !c.solid; };
let unreachable = [];
for (const c of map.cells) {
  if (!c.interactive) continue;
  if (!(floor(c.x - 1, c.y) || floor(c.x + 1, c.y) || floor(c.x, c.y - 1) || floor(c.x, c.y + 1)))
    unreachable.push(`${c.type}(${c.x},${c.y})`);
}
ok(unreachable.length === 0, 'todas las casillas interactivas son alcanzables ' + JSON.stringify(unreachable));

// --- 1b. los puntos de aparicion tienen que caer sobre suelo. Parece obvio,
//         pero al quitar una fila del mapa se quedaron dentro de la fila de
//         estaciones y los cocineros nacian empotrados: 0 platos en todas las
//         partidas y ningun error por ninguna parte.
const spawnsMalos = map.spawns
  .filter((s) => !floor(Math.floor(s.x), Math.floor(s.y)))
  .map((s) => s.x + ',' + s.y);
ok(spawnsMalos.length === 0, 'los spawns caen sobre suelo ' + JSON.stringify(spawnsMalos));
ok(map.spawns.length >= 3, 'hay un spawn por cada jugador del equipo (' + map.spawns.length + ')');

// --- 2. conectividad del suelo (flood fill desde el spawn)
const seen = new Set();
const start = { x: Math.floor(map.spawns[0].x), y: Math.floor(map.spawns[0].y) };
const q = [start];
while (q.length) {
  const p = q.pop();
  const k = p.y * map.w + p.x;
  if (seen.has(k) || !floor(p.x, p.y)) continue;
  seen.add(k);
  q.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
}
const totalFloor = map.cells.filter((c) => !c.solid).length;
ok(seen.size === totalFloor, `suelo conectado (${seen.size}/${totalFloor})`);

// --- 3. flujo completo de un plato
const eng = new Engine(map, 123, [{ id: 'p1', name: 'Test' }]);
const ch = eng.chefs.get('p1');
function faceTile(tx, ty) {
  // coloca al chef en una casilla de suelo contigua mirando al objetivo
  const opts = [[tx - 1, ty, 1, 0], [tx + 1, ty, -1, 0], [tx, ty - 1, 0, 1], [tx, ty + 1, 0, -1]];
  for (const [x, y, fx, fy] of opts) {
    if (floor(x, y)) { ch.x = x + 0.5; ch.y = y + 0.5; ch.fx = fx; ch.fy = fy; return true; }
  }
  throw new Error('sin acceso a ' + tx + ',' + ty);
}
const find = (t, ing) => map.cells.find((c) => c.type === t && (!ing || c.ing === ing));

// arroz -> olla
faceTile(find('crate', 'rice').x, find('crate', 'rice').y); eng.requestAct('p1');
ok(ch.holding && ch.holding.t === 'rice' && ch.holding.s === 'raw', 'coge arroz crudo de la caja');
const cooker = find('cooker');
faceTile(cooker.x, cooker.y); eng.requestAct('p1');
ok(!ch.holding, 'deposita el arroz en la olla');
for (let i = 0; i < Math.ceil(PREP.cookTime / DT) + 2; i++) eng.step();
const potState = eng.stateAt(cooker.x, cooker.y).pot.state;
ok(potState === 'cooked', 'el arroz se cuece (' + potState + ')');
faceTile(cooker.x, cooker.y); eng.requestAct('p1');
ok(ch.holding && ch.holding.s === 'cooked', 'recoge el arroz cocido');

// deja el arroz en una encimera libre
const counter = map.cells.find((c) => c.type === 'counter' && [[c.x - 1, c.y], [c.x + 1, c.y], [c.x, c.y - 1], [c.x, c.y + 1]].some(([x, y]) => floor(x, y)));
faceTile(counter.x, counter.y); eng.requestAct('p1');
ok(!ch.holding && eng.stateAt(counter.x, counter.y).item, 'deja el arroz en la encimera');

// gamba -> tabla -> cortar
const gcrate = find('crate', 'shrimp');
faceTile(gcrate.x, gcrate.y); eng.requestAct('p1');
ok(ch.holding && ch.holding.t === 'shrimp', 'coge gamba');
const board = find('board');
faceTile(board.x, board.y); eng.requestAct('p1');
ok(!ch.holding, 'pone la gamba en la tabla');
// cortar va a toques: un requestChop por pulsacion, con su cooldown entre medias
// el boton unico: con las manos libres, cada toque en la tabla es un tajo
for (let i = 0; i < PREP.chopTaps; i++) { eng.requestAct('p1'); for (let j = 0; j < 3; j++) eng.step(); }
ok(eng.stateAt(board.x, board.y).item.s === 'chopped', 'la gamba queda cortada');

// plato + emplatado
const plates = find('plates');
faceTile(plates.x, plates.y); eng.requestAct('p1');
ok(ch.holding && ch.holding.k === 'p' && !ch.holding.d, 'coge un plato limpio');
faceTile(board.x, board.y); eng.requestAct('p1');
ok(ch.holding.c.length === 1, 'anade la gamba al plato');
faceTile(counter.x, counter.y); eng.requestAct('p1');
ok(ch.holding.c.length === 2, 'anade el arroz al plato -> ' + JSON.stringify(ch.holding.c));

// fuerza un pedido de nigiri de gamba y sirve
eng.orders.length = 0;
eng.orders.push({ id: 99, recipe: { id: 'nigiri_gamba', score: 16, items: ['rice', 'shrimp'] }, key: 'rice+shrimp', createdAt: eng.time, expiresAt: eng.time + 70 });
const serve = find('serve');
const before = eng.score;
faceTile(serve.x, serve.y); eng.requestAct('p1');
ok(eng.delivered === 1 && eng.score > before, `sirve el plato (score ${before} -> ${eng.score})`);
ok(!ch.holding && eng.dirtyQueue.length === 1, 'el plato sucio queda en cola de devolucion');

// devolucion + fregado
for (let i = 0; i < Math.ceil(PREP.dirtyReturnDelay / DT) + 3; i++) eng.step();
const ret = find('return');
ok(eng.stateAt(ret.x, ret.y).dirty === 1, 'el plato sucio vuelve a la devolucion');
faceTile(ret.x, ret.y); eng.requestAct('p1');
ok(ch.holding && ch.holding.k === 'p' && ch.holding.d === 1, 'coge el plato sucio');
const sink = find('sink');
faceTile(sink.x, sink.y); eng.requestAct('p1');
ok(!ch.holding && eng.stateAt(sink.x, sink.y).dirty === 1, 'deja el plato en el fregadero');
ch.hold = true;                       // fregar es mantener pulsado
for (let i = 0; i < Math.ceil(PREP.washTime / DT) + 2; i++) eng.step();
ch.hold = false;
ok(eng.stateAt(sink.x, sink.y).clean === 1, 'friega el plato');
faceTile(sink.x, sink.y); eng.requestAct('p1');
ok(ch.holding && ch.holding.k === 'p' && !ch.holding.d, 'recoge el plato limpio');

// --- 4. misma semilla = mismos pedidos en ambos equipos
const e1 = new Engine(map, 777, [{ id: 'a', name: 'A' }]);
const e2 = new Engine(map, 777, [{ id: 'b', name: 'B' }]);
for (let i = 0; i < 20 * 90; i++) { e1.step(); e2.step(); }
ok(JSON.stringify(e1.orders.map((o) => o.recipe.id)) === JSON.stringify(e2.orders.map((o) => o.recipe.id)),
   'ambos equipos reciben los mismos pedidos');

// --- 5. tamano del snapshot
const snap = eng.snapshot();
const bytes = Buffer.byteLength(JSON.stringify(snap));
ok(bytes < 4000, `snapshot compacto (${bytes} bytes -> ~${Math.round(bytes * 20 / 1024)} KB/s)`);


// --- 9. mantener pulsado ya NO corta: hace falta pulsar repetidamente
{
  const e9 = new Engine(map, 55, [{ id: 'x', name: 'X' }]);
  const b = e9.map.cells.find((c) => c.type === 'board');
  const c2 = e9.chefs.get('x');
  const opts = [[b.x - 1, b.y, 1, 0], [b.x + 1, b.y, -1, 0], [b.x, b.y - 1, 0, 1], [b.x, b.y + 1, 0, -1]];
  for (const [x, y, fx, fy] of opts) { if (floor(x, y)) { c2.x = x + 0.5; c2.y = y + 0.5; c2.fx = fx; c2.fy = fy; break; } }
  e9.stateAt(b.x, b.y).item = { k: 'i', t: 'cucumber', s: 'raw' };
  c2.hold = true;
  for (let i = 0; i < 200; i++) e9.step();          // 10 segundos manteniendo
  ok(e9.stateAt(b.x, b.y).item.s === 'raw', 'mantener pulsado no corta en la tabla');
  for (let i = 0; i < PREP.chopTaps; i++) { e9.requestAct('x'); for (let j = 0; j < 3; j++) e9.step(); }
  ok(e9.stateAt(b.x, b.y).item.s === 'chopped', 'pulsar ' + PREP.chopTaps + ' veces si corta');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);

