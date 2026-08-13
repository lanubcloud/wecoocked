'use strict';

const { DT, CHEF, ORDER, PREP, THROW, PLATES_START, PLATE_CAPACITY } = require('./config');
const { INGREDIENTS, RECIPES, readyStateOf, isReady, comboKey, matchRecipe } = require('./recipes');
const { Bot } = require('./bot');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

function newIngredient(type) {
  return { k: 'i', t: type, s: 'raw' };
}
function newPlate(dirty) {
  return { k: 'p', d: dirty ? 1 : 0, c: [] };
}

/**
 * Simulacion autoritativa de una cocina (un equipo = un motor).
 * Ambos equipos comparten semilla, asi que reciben exactamente los mismos pedidos.
 */
class Engine {
  constructor(map, seed, players, teamSize) {
    this.map = map;
    this.rng = mulberry32(seed >>> 0);

    // Mas cocineros -> mas pedidos simultaneos, si no el tercer jugador
    // se queda sin nada que hacer. Se escala por el tamano de equipo de la
    // sala (igual para ambos bandos), nunca por los jugadores presentes,
    // para que las dos cocinas reciban exactamente la misma carga.
    const size = Math.max(1, Math.min(3, teamSize || players.length || 1));
    this.orderMax = [3, ORDER.maxActive, ORDER.maxActive + 1][size - 1];
    this.orderGap = [1.15, 1.0, 0.78][size - 1];
    this.time = 0;
    this.score = 0;
    this.delivered = 0;
    this.failed = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.events = [];

    this.tiles = map.cells.map((c) => this._initTile(c));
    this.returnTiles = [];
    map.cells.forEach((c, i) => { if (c.type === 'return') this.returnTiles.push(i); });

    // Indices por tipo de casilla: los usan los bots para no recorrer el mapa cada tick.
    this.byType = {};
    this.crateOf = {};
    for (const c of map.cells) {
      if (!c.interactive) continue;
      (this.byType[c.type] || (this.byType[c.type] = [])).push(c);
      if (c.type === 'crate') this.crateOf[c.ing] = c;
    }
    this.claims = new Map();   // recurso reservado -> id del bot

    this.chefs = new Map();
    this.bots = [];
    players.forEach((p, i) => {
      const sp = map.spawns[i % map.spawns.length];
      this.chefs.set(p.id, {
        id: p.id, name: p.name, slot: i, bot: !!p.bot,
        x: sp.x, y: sp.y, fx: 0, fy: -1,
        vx: 0, vy: 0,
        mx: 0, my: 0, hold: false,
        holding: null,
        dashT: 0, dashCd: 0,
        tapCd: 0, chopAnim: 0,
        speedMul: 1,
      });
      if (p.bot) this.bots.push(new Bot(this, p.id, p.level));
    });

    this.orders = [];
    this.orderSeq = 1;
    this.nextOrderAt = ORDER.firstDelay;
    this.dirtyQueue = [];
    this.flying = [];   // ingredientes en el aire
    this.ground = [];   // ingredientes caidos en el suelo
  }

  _initTile(cell) {
    switch (cell.type) {
      case 'counter': return { item: null, prog: 0 };
      case 'board':   return { item: null, prog: 0 };
      case 'cooker':  return { pot: { type: null, state: 'empty', cook: 0 } };
      case 'sink':    return { dirty: 0, clean: 0, prog: 0 };
      case 'return':  return { dirty: 0 };
      case 'plates':  return { stack: PLATES_START };
      default:        return {};
    }
  }

  // ---------------------------------------------------------------- helpers
  idx(x, y) { return y * this.map.w + x; }
  cellAt(x, y) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
    return this.map.cells[this.idx(x, y)];
  }
  stateAt(x, y) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
    return this.tiles[this.idx(x, y)];
  }
  solidAt(x, y) {
    const c = this.cellAt(x, y);
    return !c || c.solid;
  }
  blocked(x, y, r) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) return true;
    }
    return false;
  }
  frontOf(ch) {
    const d = CHEF.radius + 0.45;
    return { x: Math.floor(ch.x + ch.fx * d), y: Math.floor(ch.y + ch.fy * d) };
  }

  /** Casillas de suelo pegadas a una casilla interactiva (desde donde se puede usar). */
  standTilesFor(cell) {
    const out = [];
    const around = [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]];
    for (const [x, y] of around) if (!this.solidAt(x, y)) out.push({ x, y });
    return out;
  }

  /**
   * BFS por el suelo desde una casilla hasta la mas cercana del conjunto objetivo.
   * Devuelve la lista de casillas a recorrer (sin incluir la de partida) o null.
   */
  findPath(from, goals) {
    if (!goals.length) return null;
    const w = this.map.w, h = this.map.h;
    const goalKeys = new Set(goals.map((g) => g.y * w + g.x));
    const start = from.y * w + from.x;
    if (goalKeys.has(start)) return [];

    const prev = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    const queue = [start];
    seen[start] = 1;

    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % w, cy = (cur / w) | 0;
      const around = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of around) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || this.solidAt(nx, ny)) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        if (goalKeys.has(ni)) {
          const path = [];
          let n = ni;
          while (n !== start) { path.push({ x: n % w, y: (n / w) | 0 }); n = prev[n]; }
          return path.reverse();
        }
        queue.push(ni);
      }
    }
    return null;
  }

  // ------------------------------------------------------------- reservas
  claim(key, botId) {
    const owner = this.claims.get(key);
    if (owner && owner !== botId) return false;
    this.claims.set(key, botId);
    return true;
  }
  isClaimed(key, botId) {
    const owner = this.claims.get(key);
    return !!owner && owner !== botId;
  }
  releaseAll(botId) {
    for (const [k, v] of this.claims) if (v === botId) this.claims.delete(k);
  }
  fx(type, x, y, text) { this.events.push({ e: type, x: r2(x), y: r2(y), s: text }); }

  // ------------------------------------------------------------------ input
  setInput(id, inp) {
    const ch = this.chefs.get(id);
    if (!ch) return;
    let mx = Number(inp.mx) || 0, my = Number(inp.my) || 0;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    ch.mx = mx; ch.my = my;
    ch.hold = !!inp.hold;

    let ax = Number(inp.ax) || 0, ay = Number(inp.ay) || 0;
    const a = Math.hypot(ax, ay);
    if (a > 0.35) { ch.fx = ax / a; ch.fy = ay / a; }
    else if (m > 0.15) { ch.fx = mx / m; ch.fy = my / m; }
  }

  requestDash(id) {
    const ch = this.chefs.get(id);
    if (!ch || ch.dashCd > 0) return;
    ch.dashCd = CHEF.dashCooldown;
    ch.dashT = CHEF.dashTime;
  }

  /** Un tajo. El cooldown corta autoclickers sin estorbar a quien pulsa rapido. */
  _chopStep(ch, st, f) {
    if (ch.tapCd > 0) return;
    ch.tapCd = PREP.tapCooldown;
    ch.chopAnim = 0.18;                       // el cliente lo usa para el cuchillo
    st.prog = Math.min(1, st.prog + 1 / PREP.chopTaps);
    this.fx('tap', f.x + 0.5, f.y + 0.5, '');
    if (st.prog >= 1) {
      st.item.s = 'chopped';
      st.prog = 0;
      this.fx('chop', f.x + 0.5, f.y + 0.5, '');
    }
  }

  /** Se mantiene por compatibilidad: los bots lo usan para cortar. */
  requestChop(id) {
    const ch = this.chefs.get(id);
    if (!ch) return;
    const f = this.frontOf(ch);
    const cell = this.cellAt(f.x, f.y);
    if (!cell || cell.type !== 'board') return;
    const st = this.tiles[this.idx(f.x, f.y)];
    if (st.item && st.item.k === 'i' && st.item.s === 'raw' &&
        INGREDIENTS[st.item.t].prep === 'chop') this._chopStep(ch, st, f);
  }

  requestAct(id) {
    const ch = this.chefs.get(id);
    if (!ch) return;
    const empty = !ch.holding;
    const f = this.frontOf(ch);
    const cell = this.cellAt(f.x, f.y);
    const st = cell ? this.tiles[this.idx(f.x, f.y)] : null;

    if (cell && cell.interactive) {
      switch (cell.type) {
        case 'crate':   this._actCrate(ch, cell); break;
        case 'counter': this._actSurface(ch, st, f); break;
        case 'board':   this._actBoard(ch, st, f); break;
        case 'cooker':  this._actCooker(ch, st, f); break;
        case 'plates':  this._actPlateStack(ch, st, f); break;
        case 'sink':    this._actSink(ch, st, f); break;
        case 'return':  this._actReturn(ch, st, f); break;
        case 'trash':   this._actTrash(ch, f); break;
        case 'serve':   this._actServe(ch, f); break;
        default: break;
      }
    }
    // Si seguimos con las manos vacias, intentamos recoger algo del suelo.
    if (empty && !ch.holding) this._pickFromGround(ch);
  }

  /** Lanzamiento con el joystick derecho: solo ingredientes, nunca platos. */
  requestThrow(id, dx, dy) {
    const ch = this.chefs.get(id);
    if (!ch || !ch.holding) return;
    if (ch.holding.k === 'p') { this.fx('bad', ch.x, ch.y, 'el plato no'); return; }

    const m = Math.hypot(Number(dx) || 0, Number(dy) || 0);
    const ux = m > 0.01 ? dx / m : ch.fx;
    const uy = m > 0.01 ? dy / m : ch.fy;

    // dist arranca en el desfase inicial para que maxRange sea la distancia real al lanzador
    const off = 0.35;
    this.flying.push({ item: ch.holding, x: ch.x + ux * off, y: ch.y + uy * off, ux, uy, dist: off, from: id });
    ch.holding = null;
    ch.fx = ux; ch.fy = uy;
    this.fx('throw', ch.x, ch.y, '');
  }

  _pickFromGround(ch) {
    let best = -1, bestD = 0.95;
    for (let i = 0; i < this.ground.length; i++) {
      const g = this.ground[i];
      const d = Math.hypot(g.x - ch.x, g.y - ch.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    ch.holding = this.ground.splice(best, 1)[0].item;
  }

  _dropOnGround(item, x, y) {
    // nunca dejar un objeto dentro de una pared
    let px = x, py = y;
    if (this.solidAt(Math.floor(px), Math.floor(py))) {
      const c = this.map.cells.find((cell) => !cell.solid);
      px = c ? c.x + 0.5 : 1.5; py = c ? c.y + 0.5 : 1.5;
    }
    this.ground.push({ item, x: px, y: py });
  }

  // -------------------------------------------------------- interacciones
  _actCrate(ch, cell) {
    if (ch.holding) return;
    ch.holding = newIngredient(cell.ing);
  }

  /** Encimera generica: dejar, coger, o emplatar. */
  _actSurface(ch, st, f) {
    const held = ch.holding;
    if (!held) {
      if (st.item) { ch.holding = st.item; st.item = null; st.prog = 0; }
      return;
    }
    if (!st.item) { st.item = held; ch.holding = null; return; }

    // ingrediente en mano -> plato en la encimera
    if (held.k === 'i' && st.item.k === 'p') {
      if (this._addToPlate(st.item, held, f)) ch.holding = null;
      return;
    }
    // plato en mano <- ingrediente en la encimera
    if (held.k === 'p' && st.item.k === 'i') {
      if (this._addToPlate(held, st.item, f)) { st.item = null; st.prog = 0; }
      return;
    }
    // volcar un plato sobre otro no esta soportado
  }

  _addToPlate(plate, item, f) {
    if (plate.d) { this.fx('bad', f.x + 0.5, f.y + 0.5, 'sucio'); return false; }
    if (!isReady(item)) { this.fx('bad', f.x + 0.5, f.y + 0.5, 'sin preparar'); return false; }
    if (plate.c.length >= PLATE_CAPACITY) { this.fx('bad', f.x + 0.5, f.y + 0.5, 'lleno'); return false; }
    plate.c.push(item.t);
    plate.c.sort();
    this.fx('add', f.x + 0.5, f.y + 0.5, '');
    return true;
  }

  _actBoard(ch, st, f) {
    const held = ch.holding;
    if (!held) {
      const it = st.item;
      if (!it) return;
      // Con las manos libres y algo crudo encima, el boton corta en vez de
      // recoger: por eso "pulsar varias veces" pica el alimento.
      if (it.k === 'i' && it.s === 'raw' && INGREDIENTS[it.t].prep === 'chop') {
        this._chopStep(ch, st, f);
        return;
      }
      ch.holding = it; st.item = null; st.prog = 0;
      return;
    }
    if (st.item) { this._actSurface(ch, st, f); return; }
    if (held.k === 'i' && INGREDIENTS[held.t].prep === 'chop' && held.s === 'raw') {
      st.item = held; st.prog = 0; ch.holding = null;
      return;
    }
    // cualquier otra cosa se apoya igual (la tabla tambien es encimera)
    st.item = held; ch.holding = null;
  }

  _actCooker(ch, st, f) {
    const pot = st.pot;
    const held = ch.holding;
    if (!held) {
      if (pot.state === 'cooked' || pot.state === 'burnt') {
        const it = newIngredient(pot.type);
        it.s = pot.state === 'burnt' ? 'burnt' : 'cooked';
        ch.holding = it;
        pot.type = null; pot.state = 'empty'; pot.cook = 0;
      }
      return;
    }
    if (held.k === 'i' && INGREDIENTS[held.t].prep === 'cook' && held.s === 'raw' && pot.state === 'empty') {
      pot.type = held.t; pot.state = 'cooking'; pot.cook = 0;
      ch.holding = null;
      return;
    }
    this.fx('bad', f.x + 0.5, f.y + 0.5, 'no cabe');
  }

  _actPlateStack(ch, st) {
    if (ch.holding) return;
    if (st.stack > 0) { st.stack--; ch.holding = newPlate(false); }
  }

  _actSink(ch, st, f) {
    const held = ch.holding;
    if (held && held.k === 'p' && held.d) { st.dirty++; ch.holding = null; return; }
    if (!held && st.clean > 0) { st.clean--; ch.holding = newPlate(false); return; }
    if (!held && st.dirty > 0) { this.fx('hint', f.x + 0.5, f.y + 0.5, 'manten B'); }
  }

  _actReturn(ch, st) {
    if (ch.holding) {
      if (ch.holding.k === 'p' && ch.holding.d) { st.dirty++; ch.holding = null; }
      return;
    }
    if (st.dirty > 0) { st.dirty--; ch.holding = newPlate(true); }
  }

  _actTrash(ch, f) {
    const held = ch.holding;
    if (!held) return;
    if (held.k === 'p') {
      if (held.c.length) { held.c = []; this.fx('trash', f.x + 0.5, f.y + 0.5, ''); }
      return; // el plato nunca se destruye
    }
    ch.holding = null;
    this.fx('trash', f.x + 0.5, f.y + 0.5, '');
  }

  _actServe(ch, f) {
    const held = ch.holding;
    if (!held) return;
    if (held.k !== 'p') { this.fx('bad', f.x + 0.5, f.y + 0.5, 'usa un plato'); return; }
    if (held.d || held.c.length === 0) { this.fx('bad', f.x + 0.5, f.y + 0.5, 'plato vacio'); return; }

    const key = comboKey(held.c);
    const oi = this.orders.findIndex((o) => o.key === key);
    if (oi >= 0) {
      const order = this.orders[oi];
      this.orders.splice(oi, 1);
      const frac = Math.max(0, order.expiresAt - this.time) / ORDER.lifetime;
      const tip = Math.round(ORDER.tipMax * frac);
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const comboBonus = Math.min(20, (this.combo - 1) * 4);
      const gain = order.recipe.score + tip + comboBonus;
      this.score += gain;
      this.delivered++;
      this.fx('serve', f.x + 0.5, f.y + 0.5, `+${gain}`);
    } else {
      const recipe = matchRecipe(held.c);
      this.score = Math.max(0, this.score - ORDER.wrongPenalty);
      this.combo = 0;
      this.failed++;
      this.fx('bad', f.x + 0.5, f.y + 0.5, recipe ? 'sin pedido' : 'receta erronea');
    }
    ch.holding = null;
    this.dirtyQueue.push(this.time + PREP.dirtyReturnDelay);
  }

  // ------------------------------------------------------------------- tick
  step() {
    this.time += DT;
    this.events.length = 0;
    this._stepOrders();
    for (const b of this.bots) b.update(DT);   // los bots deciden antes de moverse
    this._stepChefs();
    this._stepFlying();
    this._stepAppliances();
    this._stepDirty();
  }

  _stepFlying() {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      // el ultimo paso se recorta para no pasarse del alcance
      const step = Math.min(THROW.speed * DT, THROW.maxRange - f.dist);
      const nx = f.x + f.ux * step;
      const ny = f.y + f.uy * step;
      f.dist += step;

      // un companero con las manos libres lo atrapa al vuelo
      let caught = false;
      for (const ch of this.chefs.values()) {
        if (ch.holding) continue;
        if (ch.id === f.from && f.dist < THROW.selfGrace) continue;
        if (Math.hypot(ch.x - nx, ch.y - ny) < THROW.catchRadius) {
          ch.holding = f.item;
          this.fx('catch', ch.x, ch.y, '');
          caught = true;
          break;
        }
      }
      if (caught) { this.flying.splice(i, 1); continue; }

      const tx = Math.floor(nx), ty = Math.floor(ny);
      if (this.solidAt(tx, ty)) {
        this._landOnTile(f, tx, ty);
        this.flying.splice(i, 1);
        continue;
      }

      f.x = nx; f.y = ny;
      if (f.dist >= THROW.maxRange - 1e-6) {
        this._dropOnGround(f.item, f.x, f.y);
        this.flying.splice(i, 1);
      }
    }
  }

  /** Choca contra un bloque: si es encimera o tabla libre se queda encima, si no cae al suelo. */
  _landOnTile(f, tx, ty) {
    const cell = this.cellAt(tx, ty);
    if (cell && (cell.type === 'counter' || cell.type === 'board')) {
      const st = this.tiles[this.idx(tx, ty)];
      if (!st.item) {
        st.item = f.item;
        st.prog = 0;
        this.fx('land', tx + 0.5, ty + 0.5, '');
        return;
      }
    }
    this._dropOnGround(f.item, f.x, f.y);
  }

  _stepOrders() {
    if (this.time >= this.nextOrderAt && this.orders.length < this.orderMax) {
      const r = RECIPES[Math.floor(this.rng() * RECIPES.length) % RECIPES.length];
      this.orders.push({
        id: this.orderSeq++,
        recipe: r,
        key: comboKey(r.items),
        createdAt: this.time,
        expiresAt: this.time + ORDER.lifetime,
      });
      const gap = (ORDER.intervalMin + this.rng() * (ORDER.intervalMax - ORDER.intervalMin)) * this.orderGap;
      this.nextOrderAt = this.time + gap;
    }
    for (let i = this.orders.length - 1; i >= 0; i--) {
      if (this.orders[i].expiresAt <= this.time) {
        this.orders.splice(i, 1);
        this.score = Math.max(0, this.score - ORDER.expirePenalty);
        this.combo = 0;
        this.failed++;
        this.fx('expire', 0, 0, `-${ORDER.expirePenalty}`);
      }
    }
  }

  _stepChefs() {
    const list = [...this.chefs.values()];

    for (const ch of list) {
      if (ch.dashCd > 0) ch.dashCd -= DT;

      let vx, vy;
      if (ch.dashT > 0) {
        ch.dashT -= DT;
        vx = ch.fx * CHEF.dashSpeed;
        vy = ch.fy * CHEF.dashSpeed;
      } else {
        vx = ch.mx * CHEF.speed * ch.speedMul;
        vy = ch.my * CHEF.speed * ch.speedMul;
      }
      ch.vx = vx; ch.vy = vy;

      const r = CHEF.radius;
      const nx = ch.x + vx * DT;
      if (!this.blocked(nx, ch.y, r)) ch.x = nx;
      const ny = ch.y + vy * DT;
      if (!this.blocked(ch.x, ny, r)) ch.y = ny;
    }

    // separacion suave entre cocineros
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = CHEF.radius * 2;
        if (d < 1e-4) { dx = 0.01; dy = 0; d = 0.01; }
        if (d < min) {
          const push = (min - d) / 2;
          let ux = dx / d, uy = dy / d;
          // Empuje puramente frontal + pasillo estrecho = dos cocineros
          // trabados de por vida. Se anade una componente lateral para que se
          // esquiven, como haria la gente al cruzarse.
          const lateral = 0.55;
          const tx = -uy * lateral, ty = ux * lateral;
          const na = Math.hypot(ux + tx, uy + ty) || 1;
          const ax = (ux + tx) / na, ay = (uy + ty) / na;
          if (!this.blocked(a.x - ax * push, a.y - ay * push, CHEF.radius)) { a.x -= ax * push; a.y -= ay * push; }
          else if (!this.blocked(a.x - ux * push, a.y - uy * push, CHEF.radius)) { a.x -= ux * push; a.y -= uy * push; }
          if (!this.blocked(b.x + ax * push, b.y + ay * push, CHEF.radius)) { b.x += ax * push; b.y += ay * push; }
          else if (!this.blocked(b.x + ux * push, b.y + uy * push, CHEF.radius)) { b.x += ux * push; b.y += uy * push; }
        }
      }
    }

    for (const ch of list) {
      if (ch.tapCd > 0) ch.tapCd -= DT;
      if (ch.chopAnim > 0) ch.chopAnim -= DT;

      // Fregar SI es mantener pulsado: es una tarea de aguantar, no de ritmo.
      if (!ch.hold) continue;
      const f = this.frontOf(ch);
      const cell = this.cellAt(f.x, f.y);
      if (!cell || cell.type !== 'sink') continue;
      const st = this.tiles[this.idx(f.x, f.y)];
      if (st.dirty <= 0) continue;
      st.prog += DT / PREP.washTime;
      if (st.prog >= 1) {
        st.dirty--; st.clean++; st.prog = 0;
        this.fx('wash', f.x + 0.5, f.y + 0.5, '');
      }
    }
  }

  _stepAppliances() {
    for (let i = 0; i < this.map.cells.length; i++) {
      const cell = this.map.cells[i];
      if (cell.type !== 'cooker') continue;
      const pot = this.tiles[i].pot;
      if (pot.state === 'empty') continue;
      pot.cook += DT;
      if (pot.state === 'cooking' && pot.cook >= PREP.cookTime) {
        pot.state = 'cooked';
        this.fx('ready', cell.x + 0.5, cell.y + 0.5, '');
      } else if (pot.state === 'cooked' && pot.cook >= PREP.burnTime) {
        pot.state = 'burnt';
        this.fx('burn', cell.x + 0.5, cell.y + 0.5, '');
      }
    }
  }

  _stepDirty() {
    if (!this.dirtyQueue.length) return;
    if (!this.returnTiles.length) { this.dirtyQueue.length = 0; return; }
    for (let i = this.dirtyQueue.length - 1; i >= 0; i--) {
      if (this.dirtyQueue[i] <= this.time) {
        this.dirtyQueue.splice(i, 1);
        this.tiles[this.returnTiles[0]].dirty++;
      }
    }
  }

  // -------------------------------------------------------------- snapshot
  snapshot() {
    const tiles = {};
    for (let i = 0; i < this.tiles.length; i++) {
      const cell = this.map.cells[i];
      if (!cell.interactive) continue;
      const st = this.tiles[i];
      let o = null;
      switch (cell.type) {
        case 'counter':
        case 'board':
          if (st.item || st.prog > 0) o = { i: st.item, p: r2(st.prog) };
          break;
        case 'cooker':
          if (st.pot.state !== 'empty') {
            const total = st.pot.state === 'cooking' ? PREP.cookTime : PREP.burnTime;
            o = { pot: { s: st.pot.state, t: st.pot.type, p: r2(Math.min(1, st.pot.cook / total)) } };
          }
          break;
        case 'sink':
          if (st.dirty || st.clean || st.prog > 0) o = { d: st.dirty, c: st.clean, p: r2(st.prog) };
          break;
        case 'return':
          if (st.dirty) o = { d: st.dirty };
          break;
        case 'plates':
          o = { n: st.stack };
          break;
        default:
          break;
      }
      if (o) tiles[i] = o;
    }

    const chefs = [];
    for (const ch of this.chefs.values()) {
      chefs.push({
        id: ch.id, n: ch.name, s: ch.slot, b: ch.bot ? 1 : 0,
        x: r2(ch.x), y: r2(ch.y), fx: r2(ch.fx), fy: r2(ch.fy),
        h: ch.holding, d: ch.dashT > 0 ? 1 : 0,
        c: ch.chopAnim > 0 ? 1 : 0,          // esta dando un tajo ahora mismo
        v: r2(Math.hypot(ch.vx, ch.vy)),     // velocidad, para animar el paso
      });
    }

    const orders = this.orders.map((o) => ({
      id: o.id, r: o.recipe.id,
      t: r2(Math.max(0, o.expiresAt - this.time) / ORDER.lifetime),
    }));

    const snap = {
      chefs, tiles, orders,
      score: this.score,
      delivered: this.delivered,
      failed: this.failed,
      combo: this.combo,
      ev: this.events.slice(),
    };
    // solo se envian si hay algo, para no engordar el snapshot
    if (this.flying.length) {
      snap.fly = this.flying.map((f) => ({ x: r2(f.x), y: r2(f.y), i: f.item, p: r2(f.dist / THROW.maxRange) }));
    }
    if (this.ground.length) {
      snap.gnd = this.ground.map((g) => ({ x: r2(g.x), y: r2(g.y), i: g.item }));
    }
    return snap;
  }

  stats() {
    return {
      score: this.score,
      delivered: this.delivered,
      failed: this.failed,
      bestCombo: this.bestCombo,
    };
  }
}

module.exports = { Engine, mulberry32 };
