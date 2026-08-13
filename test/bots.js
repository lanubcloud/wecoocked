'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildMap } = require(path.join(ROOT, 'server/game/map.js'));
const { Engine } = require(path.join(ROOT, 'server/game/engine.js'));
const { TICK_HZ, MATCH_SECONDS } = require(path.join(ROOT, 'server/game/config.js'));

const map = buildMap();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function runMatch(players, seconds) {
  const eng = new Engine(map, 2024, players);
  const ticks = Math.round(seconds * TICK_HZ);
  let stuckTicks = 0;
  const prev = new Map();
  for (let i = 0; i < ticks; i++) {
    eng.step();
    // vigila que ningun bot se quede clavado toda la partida
    for (const ch of eng.chefs.values()) {
      const p = prev.get(ch.id);
      if (p && Math.hypot(ch.x - p.x, ch.y - p.y) < 0.001 && !ch.hold) stuckTicks++;
      prev.set(ch.id, { x: ch.x, y: ch.y });
    }
  }
  return { eng, stuckTicks, ticks };
}

// --- 1. un bot solo es capaz de servir platos en 3 minutos
for (const level of ['facil', 'normal', 'dificil']) {
  const { eng } = runMatch([{ id: 'b1', name: 'Kenji', bot: true, level }], MATCH_SECONDS);
  ok(eng.delivered > 0, `[${level}] un bot solo sirve platos: ${eng.delivered} platos, ${eng.score} pts`);
}

// --- 2. mas bots = mas produccion
{
  const uno = runMatch([{ id: 'b1', name: 'A', bot: true, level: 'dificil' }], MATCH_SECONDS).eng;
  const tres = runMatch([
    { id: 'b1', name: 'A', bot: true, level: 'dificil' },
    { id: 'b2', name: 'B', bot: true, level: 'dificil' },
    { id: 'b3', name: 'C', bot: true, level: 'dificil' },
  ], MATCH_SECONDS).eng;
  ok(tres.delivered >= uno.delivered, `3 bots (${tres.delivered}) rinden al menos como 1 bot (${uno.delivered})`);
  console.log(`      1 bot: ${uno.delivered} platos / ${uno.score} pts   |   3 bots: ${tres.delivered} platos / ${tres.score} pts`);
}

// --- 3. el nivel dificil rinde mas que el facil
{
  const f = runMatch([{ id: 'b1', name: 'F', bot: true, level: 'facil' }], MATCH_SECONDS).eng;
  const d = runMatch([{ id: 'b1', name: 'D', bot: true, level: 'dificil' }], MATCH_SECONDS).eng;
  ok(d.delivered >= f.delivered, `dificil (${d.delivered}) >= facil (${f.delivered})`);
}

// --- 4. humano + bot conviven sin romperse
{
  const { eng } = runMatch([
    { id: 'humano', name: 'Yo' },
    { id: 'b1', name: 'Kenji', bot: true, level: 'normal' },
  ], 90);
  const humano = eng.chefs.get('humano');
  // el humano puede ser empujado por un bot al pasar (fisica normal),
  // pero nunca debe recibir input ni actuar por su cuenta
  ok(humano && humano.mx === 0 && humano.my === 0 && !humano.hold && humano.holding === null,
     'el cocinero humano no recibe input ni actua solo');
  ok(eng.delivered > 0, `el bot companero produce igualmente: ${eng.delivered} platos`);
}

// --- 5. los bots no acaparan los mismos recursos
{
  const { eng } = runMatch([
    { id: 'b1', name: 'A', bot: true, level: 'dificil' },
    { id: 'b2', name: 'B', bot: true, level: 'dificil' },
    { id: 'b3', name: 'C', bot: true, level: 'dificil' },
  ], 60);
  const owners = new Set(eng.claims.values());
  const dup = [...eng.claims.entries()].filter(([k, v], i, arr) => arr.findIndex(([k2]) => k2 === k) !== i);
  ok(dup.length === 0, 'ninguna reserva esta duplicada');
  ok(owners.size <= 3, `las reservas activas pertenecen a bots reales (${eng.claims.size} reservas)`);
}

// --- 6. no se pierden platos: los 5 iniciales siguen existiendo en algun sitio
{
  const { eng } = runMatch([
    { id: 'b1', name: 'A', bot: true, level: 'dificil' },
    { id: 'b2', name: 'B', bot: true, level: 'normal' },
  ], MATCH_SECONDS);
  let platos = 0;
  const stack = eng.byType.plates[0];
  platos += eng.stateAt(stack.x, stack.y).stack;
  for (const c of eng.byType.counter) { const it = eng.stateAt(c.x, c.y).item; if (it && it.k === 'p') platos++; }
  for (const c of eng.byType.board) { const it = eng.stateAt(c.x, c.y).item; if (it && it.k === 'p') platos++; }
  for (const c of eng.byType.sink) { const s = eng.stateAt(c.x, c.y); platos += s.dirty + s.clean; }
  for (const c of eng.byType.return) platos += eng.stateAt(c.x, c.y).dirty;
  for (const ch of eng.chefs.values()) if (ch.holding && ch.holding.k === 'p') platos++;
  platos += eng.dirtyQueue.length;
  ok(platos === 5, `los 5 platos siguen en juego (encontrados: ${platos})`);
  console.log(`      resultado 2 bots: ${eng.delivered} platos servidos, ${eng.score} pts, ${eng.failed} fallos`);
}

// --- 7. rendimiento: una partida entera debe simularse rapido
{
  const t0 = Date.now();
  runMatch([
    { id: 'b1', name: 'A', bot: true, level: 'dificil' },
    { id: 'b2', name: 'B', bot: true, level: 'dificil' },
    { id: 'b3', name: 'C', bot: true, level: 'dificil' },
  ], MATCH_SECONDS);
  const ms = Date.now() - t0;
  ok(ms < 3000, `3 min de partida con 3 bots simulados en ${ms} ms (presupuesto real: 180000 ms)`);
}


// --- 8. sin bloqueos: dos cocineros que se cruzan no pueden quedarse trabados.
// Con pasillos de una sola casilla, dos bots yendo en sentidos opuestos se
// atascaban de por vida y la cocina entera se paraba (0 platos).
{
  const malos = [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i < 6; i++) {
      const p = [];
      for (let k = 0; k < n; k++) p.push({ id: 'b' + k, name: 'B' + k, bot: true, level: 'dificil' });
      const eng = new Engine(map, 3000 + i, p, n);
      for (let t = 0; t < TICK_HZ * MATCH_SECONDS; t++) eng.step();
      if (eng.delivered < 4) malos.push(n + ' bots -> ' + eng.delivered);
    }
  }
  ok(malos.length === 0, 'ninguna partida con 2 o 3 bots se bloquea: ' + (malos.join(', ') || 'todas producen'));
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);

