'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildMap } = require(path.join(ROOT, 'server/game/map.js'));
const { Engine } = require(path.join(ROOT, 'server/game/engine.js'));
const { THROW } = require(path.join(ROOT, 'server/game/config.js'));

const map = buildMap();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const floor = (x, y) => { const c = map.cells[y * map.w + x]; return c && !c.solid; };

/**
 * Coordenadas derivadas del mapa, no escritas a mano: asi los tests siguen
 * valiendo cuando se rediseña la cocina.
 */
function tramoLibre() {
  // busca la fila con mas suelo seguido y devuelve su y y sus extremos
  let mejor = { y: 1, x0: 1, x1: 1, largo: 0 };
  for (let y = 1; y < map.h - 1; y++) {
    let x0 = -1;
    for (let x = 1; x <= map.w - 1; x++) {
      if (floor(x, y)) { if (x0 < 0) x0 = x; }
      else { if (x0 >= 0 && x - x0 > mejor.largo) mejor = { y, x0, x1: x - 1, largo: x - x0 }; x0 = -1; }
    }
  }
  return mejor;
}
const pasillo = tramoLibre();

function fresh(players) { return new Engine(map, 42, players, players.length); }
function put(eng, id, x, y, fx, fy) {
  const ch = eng.chefs.get(id);
  ch.x = x; ch.y = y; ch.fx = fx; ch.fy = fy;
  return ch;
}
/** Casilla contigua de suelo desde donde se puede mirar a `cell`. */
function junto(cell) {
  const opts = [[cell.x - 1, cell.y, 1, 0], [cell.x + 1, cell.y, -1, 0], [cell.x, cell.y - 1, 0, 1], [cell.x, cell.y + 1, 0, -1]];
  for (const [x, y, fx, fy] of opts) if (floor(x, y)) return { x: x + 0.5, y: y + 0.5, fx, fy };
  throw new Error('sin acceso a ' + cell.x + ',' + cell.y);
}

console.log(`(pasillo de pruebas: fila ${pasillo.y}, de x=${pasillo.x0} a x=${pasillo.x1})`);

// --- 1. un companero atrapa el ingrediente al vuelo
{
  const eng = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const a = put(eng, 'a', pasillo.x0 + 0.5, pasillo.y + 0.5, 1, 0);
  const b = put(eng, 'b', pasillo.x0 + 4.5, pasillo.y + 0.5, -1, 0);
  a.holding = { k: 'i', t: 'nori', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  ok(!a.holding && eng.flying.length === 1, 'al lanzar, el objeto sale de las manos y vuela');
  for (let i = 0; i < 60 && !b.holding; i++) eng.step();
  ok(b.holding && b.holding.t === 'nori', 'el companero lo atrapa al vuelo');
  ok(eng.flying.length === 0, 'el objeto volador desaparece tras atraparse');
}

// --- 2. el que lanza no se lo auto-atrapa nada mas soltarlo
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const a = put(eng, 'a', pasillo.x0 + 0.5, pasillo.y + 0.5, 1, 0);
  a.holding = { k: 'i', t: 'nori', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  eng.step();
  ok(!a.holding && eng.flying.length === 1, 'no se auto-atrapa en el primer tick');
}

// --- 3. aterriza sobre una encimera libre
const isla = map.cells.find((c) => c.type === 'counter' && floor(c.x + 1, c.y));
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const a = put(eng, 'a', isla.x + 3.5, isla.y + 0.5, -1, 0);
  a.holding = { k: 'i', t: 'salmon', s: 'chopped' };
  eng.requestThrow('a', -1, 0);
  for (let i = 0; i < 60 && eng.flying.length; i++) eng.step();
  const st = eng.stateAt(isla.x, isla.y);
  ok(st.item && st.item.t === 'salmon' && st.item.s === 'chopped',
     'aterriza en la encimera libre conservando su estado');
}

// --- 4. si la encimera esta ocupada, cae al suelo y se puede recoger
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  eng.stateAt(isla.x, isla.y).item = { k: 'i', t: 'nori', s: 'raw' };
  const a = put(eng, 'a', isla.x + 3.5, isla.y + 0.5, -1, 0);
  a.holding = { k: 'i', t: 'salmon', s: 'chopped' };
  eng.requestThrow('a', -1, 0);
  for (let i = 0; i < 60 && eng.flying.length; i++) eng.step();
  ok(eng.ground.length === 1, 'rebota al suelo si la encimera esta ocupada');
  const g = eng.ground[0];
  ok(floor(Math.floor(g.x), Math.floor(g.y)), 'nunca cae dentro de una pared');
  a.x = g.x; a.y = g.y; a.fx = 0; a.fy = 1;
  eng.requestAct('a');
  ok(a.holding && a.holding.t === 'salmon' && eng.ground.length === 0, 'se recoge del suelo con el boton');
}

// --- 5. los platos no se lanzan
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const a = put(eng, 'a', pasillo.x0 + 0.5, pasillo.y + 0.5, 1, 0);
  a.holding = { k: 'p', d: 0, c: ['rice'] };
  eng.requestThrow('a', 1, 0);
  ok(a.holding && a.holding.k === 'p' && eng.flying.length === 0, 'un plato no se puede lanzar');
}

// --- 6. sin alcance suficiente cae al suelo, no desaparece
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const x0 = pasillo.x0 + 0.5;
  const a = put(eng, 'a', x0, pasillo.y + 0.5, 1, 0);
  a.holding = { k: 'i', t: 'rice', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  for (let i = 0; i < 200 && eng.flying.length; i++) eng.step();
  const enSuelo = eng.ground.length === 1;
  const enEncimera = eng.map.cells.some((c) => (c.type === 'counter' || c.type === 'board') && eng.stateAt(c.x, c.y).item);
  ok(enSuelo || enEncimera, 'al agotar el alcance el objeto no se pierde');
  if (enSuelo) {
    const dist = Math.hypot(eng.ground[0].x - x0, eng.ground[0].y - (pasillo.y + 0.5));
    ok(dist <= THROW.maxRange + 0.01, `no supera el alcance maximo (${dist.toFixed(2)} <= ${THROW.maxRange})`);
  } else {
    ok(true, 'choco contra una encimera antes de agotar el alcance');
  }
}

// --- 7. la interaccion normal con encimeras tiene prioridad sobre el suelo
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const caja = map.cells.find((c) => c.type === 'crate' && c.ing === 'rice');
  const p = junto(caja);
  eng.ground.push({ item: { k: 'i', t: 'nori', s: 'raw' }, x: p.x, y: p.y });
  const a = put(eng, 'a', p.x, p.y, p.fx, p.fy);
  eng.requestAct('a');
  ok(a.holding && a.holding.t === 'rice', 'la caja gana al objeto del suelo cuando la miras');
  ok(eng.ground.length === 1, 'el objeto del suelo sigue ahi');
}

// --- 8. el snapshot solo crece cuando hay algo en el aire o en el suelo
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const base = eng.snapshot();
  ok(base.fly === undefined && base.gnd === undefined, 'sin lanzamientos el snapshot no lleva fly/gnd');
  const a = put(eng, 'a', pasillo.x0 + 0.5, pasillo.y + 0.5, 1, 0);
  a.holding = { k: 'i', t: 'rice', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  eng.step();
  const s2 = eng.snapshot();
  ok(Array.isArray(s2.fly) && s2.fly.length === 1 && typeof s2.fly[0].p === 'number',
     'con algo en el aire aparece fly con su progreso de arco');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
