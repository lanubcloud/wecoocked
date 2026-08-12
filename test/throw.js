'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildMap } = require(path.join(ROOT, 'server/game/map.js'));
const { Engine } = require(path.join(ROOT, 'server/game/engine.js'));
const { DT, THROW } = require(path.join(ROOT, 'server/game/config.js'));

const map = buildMap();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const find = (t, ing) => map.cells.find((c) => c.type === t && (!ing || c.ing === ing));
const floor = (x, y) => { const c = map.cells[y * map.w + x]; return c && !c.solid; };

function fresh(players) { return new Engine(map, 42, players); }
function put(eng, id, x, y, fx, fy) {
  const ch = eng.chefs.get(id);
  ch.x = x; ch.y = y; ch.fx = fx; ch.fy = fy;
  return ch;
}

// --- 1. un companero atrapa el ingrediente al vuelo
{
  const eng = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const a = put(eng, 'a', 2.5, 11.5, 1, 0);
  const b = put(eng, 'b', 8.5, 11.5, -1, 0);
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
  const a = put(eng, 'a', 2.5, 11.5, 1, 0);
  a.holding = { k: 'i', t: 'nori', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  eng.step();
  ok(!a.holding && eng.flying.length === 1, 'no se auto-atrapa en el primer tick');
}

// --- 3. aterriza sobre una encimera libre
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const target = { x: 1, y: 9 };                       // encimera del pasillo izquierdo
  const a = put(eng, 'a', 5.5, 9.5, -1, 0);
  a.holding = { k: 'i', t: 'salmon', s: 'chopped' };
  eng.requestThrow('a', -1, 0);
  for (let i = 0; i < 60 && eng.flying.length; i++) eng.step();
  const st = eng.stateAt(target.x, target.y);
  ok(st.item && st.item.t === 'salmon' && st.item.s === 'chopped',
     'aterriza en la encimera libre conservando su estado');
}

// --- 4. si la encimera esta ocupada, cae al suelo y se puede recoger
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  eng.stateAt(1, 9).item = { k: 'i', t: 'nori', s: 'raw' };   // la ocupamos
  const a = put(eng, 'a', 5.5, 9.5, -1, 0);
  a.holding = { k: 'i', t: 'salmon', s: 'chopped' };
  eng.requestThrow('a', -1, 0);
  for (let i = 0; i < 60 && eng.flying.length; i++) eng.step();
  ok(eng.ground.length === 1, 'rebota al suelo si la encimera esta ocupada');
  const g = eng.ground[0];
  ok(floor(Math.floor(g.x), Math.floor(g.y)), 'nunca cae dentro de una pared');
  // el cocinero va a recogerlo
  a.x = g.x; a.y = g.y; a.fx = 0; a.fy = 1;
  eng.requestAct('a');
  ok(a.holding && a.holding.t === 'salmon' && eng.ground.length === 0, 'se recoge del suelo con el boton A');
}

// --- 5. los platos no se lanzan
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const a = put(eng, 'a', 5.5, 11.5, 1, 0);
  a.holding = { k: 'p', d: 0, c: ['rice'] };
  eng.requestThrow('a', 1, 0);
  ok(a.holding && a.holding.k === 'p' && eng.flying.length === 0, 'un plato no se puede lanzar');
}

// --- 6. sin alcance suficiente cae al suelo, no desaparece
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const a = put(eng, 'a', 3.5, 11.5, 1, 0);
  a.holding = { k: 'i', t: 'rice', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  for (let i = 0; i < 200 && eng.flying.length; i++) eng.step();
  ok(eng.ground.length === 1, 'al agotar el alcance cae al suelo (no se pierde)');
  const dist = Math.hypot(eng.ground[0].x - 3.5, eng.ground[0].y - 11.5);
  ok(dist <= THROW.maxRange + 0.5, `no supera el alcance maximo (${dist.toFixed(2)} <= ${THROW.maxRange})`);
}

// --- 7. la interaccion normal con encimeras sigue teniendo prioridad sobre el suelo
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  eng.ground.push({ item: { k: 'i', t: 'nori', s: 'raw' }, x: 2.5, y: 3.5 });
  const a = put(eng, 'a', 2.5, 3.5, -1, 0);            // mirando a la caja de arroz (1,3)
  eng.requestAct('a');
  ok(a.holding && a.holding.t === 'rice', 'la caja gana al objeto del suelo cuando la miras');
  ok(eng.ground.length === 1, 'el objeto del suelo sigue ahi');
}

// --- 8. el snapshot solo crece cuando hay algo en el aire o en el suelo
{
  const eng = fresh([{ id: 'a', name: 'A' }]);
  const base = eng.snapshot();
  ok(base.fly === undefined && base.gnd === undefined, 'sin lanzamientos el snapshot no lleva fly/gnd');
  const a = put(eng, 'a', 3.5, 11.5, 1, 0);
  a.holding = { k: 'i', t: 'rice', s: 'raw' };
  eng.requestThrow('a', 1, 0);
  eng.step();
  const s2 = eng.snapshot();
  ok(Array.isArray(s2.fly) && s2.fly.length === 1 && typeof s2.fly[0].p === 'number',
     'con algo en el aire aparece fly con su progreso de arco');
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);

