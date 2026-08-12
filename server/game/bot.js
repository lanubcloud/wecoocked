'use strict';

const { INGREDIENTS, RECIPES, readyStateOf } = require('./recipes');

/**
 * Niveles de dificultad.
 *  speed  - multiplicador de velocidad del cocinero
 *  react  - segundos de pausa antes de cada accion (simula reflejos)
 *  sloppy - probabilidad de despistarse un momento al terminar un paso
 */
const LEVELS = {
  facil:   { id: 'facil',   name: 'Facil',   speed: 0.70, react: 0.55, sloppy: 0.20 },
  normal:  { id: 'normal',  name: 'Normal',  speed: 0.88, react: 0.25, sloppy: 0.07 },
  dificil: { id: 'dificil', name: 'Dificil', speed: 1.00, react: 0.10, sloppy: 0.02 },
};

const ARRIVE = 0.16;      // margen para dar por buena la casilla destino
const STUCK_TIME = 1.4;   // segundos sin avanzar antes de recalcular la ruta

/**
 * Bot cocinero. Juega con exactamente las mismas reglas que un humano:
 * solo mueve el joystick virtual y pulsa A / mantiene B a traves de la
 * misma API del motor (`requestAct`, `ch.mx/my`, `ch.hold`).
 *
 * Cada bot se encarga de un pedido completo de principio a fin, reservando
 * los recursos que necesita (olla, tabla, encimera) para no pisarse con
 * sus companeros.
 */
class Bot {
  constructor(engine, id, level) {
    this.eng = engine;
    this.id = id;
    this.level = LEVELS[level] || LEVELS.normal;
    this.steps = null;
    this.stepIdx = 0;
    this.path = null;
    this.pathIdx = 0;
    this.wait = this.level.react;
    this.stuck = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.replanCooldown = 0;
  }

  get chef() { return this.eng.chefs.get(this.id); }

  update(dt) {
    const ch = this.chef;
    if (!ch) return;
    ch.speedMul = this.level.speed;

    if (this.wait > 0) { this.wait -= dt; ch.mx = 0; ch.my = 0; ch.hold = false; return; }
    if (this.replanCooldown > 0) this.replanCooldown -= dt;

    if (!this.steps) {
      if (this.replanCooldown > 0) { ch.mx = 0; ch.my = 0; return; }
      this._buildPlan(ch);
      if (!this.steps) { ch.mx = 0; ch.my = 0; this.replanCooldown = 0.8; return; }
    }
    this._runStep(ch, dt);
  }

  // ------------------------------------------------------------ ejecucion
  _runStep(ch, dt) {
    const step = this.steps[this.stepIdx];
    if (!step) { this._finishPlan(); return; }

    const cell = this.eng.cellAt(step.tile.x, step.tile.y);
    if (!cell) { this._abort(); return; }

    // 1. acercarse
    if (!this._isInPosition(ch, step.tile)) {
      ch.hold = false;
      this._walkTo(ch, step.tile, dt);
      return;
    }
    ch.mx = 0; ch.my = 0;
    this._face(ch, step.tile);

    // 2. actuar segun el tipo de paso
    switch (step.kind) {
      case 'act':
        ch.hold = false;
        this.eng.requestAct(this.id);
        this._nextStep();
        break;

      case 'chop': {
        const st = this.eng.stateAt(step.tile.x, step.tile.y);
        const it = st && st.item;
        if (it && it.k === 'i' && it.s === 'raw' && INGREDIENTS[it.t].prep === 'chop') {
          this.eng.requestChop(this.id);        // un toque por tick, como un humano
        } else {
          this.eng.requestAct(this.id);         // ya esta cortado: recogerlo
          this._nextStep();
        }
        break;
      }

      case 'cookWait': {
        const st = this.eng.stateAt(step.tile.x, step.tile.y);
        const pot = st && st.pot;
        ch.hold = false;
        if (!pot || pot.state === 'empty') { this._abort(); break; }
        if (pot.state === 'cooked' || pot.state === 'burnt') {
          this.eng.requestAct(this.id);
          this._nextStep();
        }
        break;                                   // si sigue cociendo, esperamos
      }

      case 'wash': {
        const st = this.eng.stateAt(step.tile.x, step.tile.y);
        if (!st) { this._abort(); break; }
        if (st.clean > 0) {
          this.eng.requestAct(this.id);          // coger plato limpio
          this._nextStep();
        } else if (st.dirty > 0) {
          this.eng.requestChop(this.id);         // fregar tambien va a toques
        } else {
          this._abort();
        }
        break;
      }

      default:
        this._abort();
    }
  }

  _nextStep() {
    this.stepIdx++;
    this.path = null;
    this.standTile = null;
    const ch = this.chef;
    if (ch) ch.hold = false;
    // Jitter en los reflejos: sin el, dos equipos de bots del mismo nivel harian
    // exactamente lo mismo (mismos pedidos + IA determinista) y siempre empatarian.
    this.wait = this.level.react * (0.75 + Math.random() * 0.5);
    if (this.level.sloppy && Math.random() < this.level.sloppy) this.wait += 0.3 + Math.random() * 0.5;
    if (this.stepIdx >= this.steps.length) this._finishPlan();
  }

  _finishPlan() {
    this.eng.releaseAll(this.id);
    this.steps = null;
    this.stepIdx = 0;
    this.path = null;
    this.standTile = null;
    const ch = this.chef;
    if (ch) { ch.hold = false; ch.mx = 0; ch.my = 0; }
  }

  _abort() {
    this._finishPlan();
    this.replanCooldown = 0.5;
  }

  // ----------------------------------------------------------- movimiento
  _isInPosition(ch, target) {
    const f = this.eng.frontOf(ch);
    if (f.x === target.x && f.y === target.y) return true;
    // tambien vale estar ya plantado en la casilla contigua elegida
    if (this.standTile) {
      const d = Math.hypot(ch.x - (this.standTile.x + 0.5), ch.y - (this.standTile.y + 0.5));
      if (d < ARRIVE) { this._face(ch, target); const g = this.eng.frontOf(ch); return g.x === target.x && g.y === target.y; }
    }
    return false;
  }

  _walkTo(ch, target, dt) {
    if (!this.path || !this.path.length) {
      const cell = this.eng.cellAt(target.x, target.y);
      const goals = this.eng.standTilesFor(cell);
      if (!goals.length) { this._abort(); return; }
      const from = { x: Math.floor(ch.x), y: Math.floor(ch.y) };
      const path = this.eng.findPath(from, goals);
      if (!path) { this._abort(); return; }
      this.path = path.length ? path : [from];
      this.pathIdx = 0;
      this.standTile = this.path[this.path.length - 1];
      this.stuck = 0;
    }

    const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
    const tx = wp.x + 0.5, ty = wp.y + 0.5;
    let dx = tx - ch.x, dy = ty - ch.y;
    const d = Math.hypot(dx, dy);
    const last = this.pathIdx >= this.path.length - 1;

    if (d < (last ? ARRIVE : 0.28)) {
      if (last) { ch.mx = 0; ch.my = 0; return; }
      this.pathIdx++;
      return;
    }

    ch.mx = dx / d;
    ch.my = dy / d;
    ch.fx = ch.mx; ch.fy = ch.my;

    // detector de atascos: si no avanzamos, recalculamos y probamos otra ruta
    const moved = Math.hypot(ch.x - this.lastX, ch.y - this.lastY);
    this.lastX = ch.x; this.lastY = ch.y;
    this.stuck = moved < 0.01 ? this.stuck + dt : 0;
    if (this.stuck > STUCK_TIME) {
      this.stuck = 0;
      this.path = null;
      ch.mx = -ch.mx * 0.5 + (Math.random() - 0.5);   // pequeno rodeo
      ch.my = -ch.my * 0.5 + (Math.random() - 0.5);
    }
  }

  _face(ch, tile) {
    const dx = (tile.x + 0.5) - ch.x, dy = (tile.y + 0.5) - ch.y;
    const d = Math.hypot(dx, dy) || 1;
    ch.fx = dx / d; ch.fy = dy / d;
  }

  // ---------------------------------------------------------- planificacion
  _buildPlan(ch) {
    const eng = this.eng;

    // Con algo raro en las manos, primero nos lo quitamos de encima.
    if (ch.holding) {
      const h = ch.holding;
      if (h.k === 'p' && h.d) return this._planWash(true);
      if (h.k === 'p' && !h.c.length) return this._planOrder(true);
      if (h.k === 'p') return this._planServeHeld();
      const trash = eng.byType.trash && eng.byType.trash[0];
      if (trash) { this.steps = [{ tile: trash, kind: 'act' }]; this.stepIdx = 0; return; }
      return;
    }

    // Una olla con arroz quemado bloquea la cocina: prioridad maxima.
    const burnt = (eng.byType.cooker || []).find((c) => eng.stateAt(c.x, c.y).pot.state === 'burnt');
    if (burnt) {
      const trash = eng.byType.trash && eng.byType.trash[0];
      if (trash && eng.claim('cooker:' + burnt.x + ',' + burnt.y, this.id)) {
        this.steps = [{ tile: burnt, kind: 'act' }, { tile: trash, kind: 'act' }];
        this.stepIdx = 0;
        return;
      }
    }

    // Sin platos limpios hay que fregar.
    const stack = eng.byType.plates && eng.byType.plates[0];
    const stackLeft = stack ? eng.stateAt(stack.x, stack.y).stack : 0;
    if (stackLeft <= 0) return this._planWash(false);

    return this._planOrder(false);
  }

  /** Ciclo de fregado: recoger sucio -> fregadero -> mantener B -> plato limpio. */
  _planWash(holdingDirty) {
    const eng = this.eng;
    const sink = (eng.byType.sink || []).find((s) => !eng.isClaimed('sink:' + s.x + ',' + s.y, this.id));
    if (!sink) return;
    if (!eng.claim('sink:' + sink.x + ',' + sink.y, this.id)) return;

    const steps = [];
    if (!holdingDirty) {
      const sinkSt = eng.stateAt(sink.x, sink.y);
      if (sinkSt.clean > 0) {
        steps.push({ tile: sink, kind: 'act' });          // ya hay uno limpio
      } else if (sinkSt.dirty > 0) {
        steps.push({ tile: sink, kind: 'wash' });
      } else {
        const ret = (eng.byType.return || []).find((r) => eng.stateAt(r.x, r.y).dirty > 0);
        if (!ret) { eng.releaseAll(this.id); return; }
        steps.push({ tile: ret, kind: 'act' });
        steps.push({ tile: sink, kind: 'act' });
        steps.push({ tile: sink, kind: 'wash' });
      }
    } else {
      steps.push({ tile: sink, kind: 'act' });
      steps.push({ tile: sink, kind: 'wash' });
    }
    this.steps = steps;
    this.stepIdx = 0;
  }

  /** Si ya llevamos un plato montado, solo queda entregarlo. */
  _planServeHeld() {
    const serve = this.eng.byType.serve && this.eng.byType.serve[0];
    if (!serve) return;
    this.steps = [{ tile: serve, kind: 'act' }];
    this.stepIdx = 0;
  }

  /**
   * Plan completo de un pedido: plato en una encimera de montaje, cada
   * ingrediente preparado y anadido, y entrega final.
   */
  _planOrder(holdingPlate) {
    const eng = this.eng;

    const order = this._pickOrder();
    if (!order) return;

    const recipe = order.recipe;
    const needsCook = recipe.items.some((t) => INGREDIENTS[t].prep === 'cook');
    const needsChop = recipe.items.some((t) => INGREDIENTS[t].prep === 'chop');

    const bench = this._claimFreeCounter();
    if (!bench) return;
    const cooker = needsCook ? this._claimTile('cooker', (c) => eng.stateAt(c.x, c.y).pot.state === 'empty') : null;
    const board = needsChop ? this._claimTile('board', (c) => !eng.stateAt(c.x, c.y).item) : null;
    if ((needsCook && !cooker) || (needsChop && !board)) { eng.releaseAll(this.id); return; }

    eng.claim('order:' + order.id, this.id);

    const steps = [];
    const stack = eng.byType.plates && eng.byType.plates[0];
    if (!holdingPlate) {
      if (!stack) { eng.releaseAll(this.id); return; }
      steps.push({ tile: stack, kind: 'act' });          // coger plato limpio
    }
    steps.push({ tile: bench, kind: 'act' });            // dejarlo en la encimera de montaje

    for (const type of recipe.items) {
      const crate = eng.crateOf[type];
      if (!crate) { eng.releaseAll(this.id); return; }
      steps.push({ tile: crate, kind: 'act' });          // coger el ingrediente crudo
      const prep = INGREDIENTS[type].prep;
      if (prep === 'cook') {
        steps.push({ tile: cooker, kind: 'act' });       // meter en la olla
        steps.push({ tile: cooker, kind: 'cookWait' });  // esperar y recoger
      } else if (prep === 'chop') {
        steps.push({ tile: board, kind: 'act' });        // dejar en la tabla
        steps.push({ tile: board, kind: 'chop' });       // cortar y recoger
      }
      steps.push({ tile: bench, kind: 'act' });          // anadir al plato
    }

    steps.push({ tile: bench, kind: 'act' });            // recoger el plato montado
    const serve = eng.byType.serve && eng.byType.serve[0];
    if (!serve) { eng.releaseAll(this.id); return; }
    steps.push({ tile: serve, kind: 'act' });

    this.steps = steps;
    this.stepIdx = 0;
  }

  /**
   * Pedido sin reclamar, prefiriendo los que tienen mas margen. Entre los dos
   * mejores se elige al azar: sin ese desempate, dos equipos de bots del mismo
   * nivel cocinarian en el mismo orden y acabarian siempre igualados.
   */
  _pickOrder() {
    const eng = this.eng;
    const free = eng.orders.filter((o) => !eng.isClaimed('order:' + o.id, this.id));
    if (!free.length) return null;
    free.sort((a, b) => b.expiresAt - a.expiresAt);
    const top = free.slice(0, 2);
    return top[Math.floor(Math.random() * top.length)];
  }

  _claimTile(type, isFree) {
    const eng = this.eng;
    for (const c of eng.byType[type] || []) {
      const key = type + ':' + c.x + ',' + c.y;
      if (eng.isClaimed(key, this.id)) continue;
      if (!isFree(c)) continue;
      if (eng.claim(key, this.id)) return c;
    }
    return null;
  }

  /** Encimera de montaje libre, la mas cercana posible a la ventanilla. */
  _claimFreeCounter() {
    const eng = this.eng;
    const serve = eng.byType.serve && eng.byType.serve[0];
    const list = (eng.byType.counter || []).filter((c) => {
      const key = 'counter:' + c.x + ',' + c.y;
      return !eng.isClaimed(key, this.id) && !eng.stateAt(c.x, c.y).item;
    });
    if (!list.length) return null;
    if (serve) list.sort((a, b) => Math.hypot(a.x - serve.x, a.y - serve.y) - Math.hypot(b.x - serve.x, b.y - serve.y));
    const c = list[0];
    return eng.claim('counter:' + c.x + ',' + c.y, this.id) ? c : null;
  }
}

module.exports = { Bot, LEVELS };
