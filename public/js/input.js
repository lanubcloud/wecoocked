/* Controles tactiles: dos joysticks flotantes (mover / apuntar) + botones A, B, DASH. */
(function (global) {
  'use strict';

  const MAX_R = 56;       // radio maximo del knob en px
  const DEAD = 0.08;      // zona muerta pequena: responde en cuanto mueves el pulgar

  /**
   * Joystick virtual.
   *  - fixed:true  -> base anclada en su sitio (el de movimiento). Se puede
   *    tocar en cualquier parte de la zona y el knob se mide desde el centro
   *    de la base, asi no hay que acertar en el circulo.
   *  - fixed:false -> base flotante, aparece donde pongas el dedo (apuntar).
   */
  class Stick {
    constructor(zoneEl, stickEl, fixed) {
      this.zone = zoneEl;
      this.el = stickEl;
      this.knob = stickEl.querySelector('.knob');
      this.fixed = !!fixed;
      this.pointer = null;
      this.ox = 0; this.oy = 0;
      this.x = 0; this.y = 0;   // -1..1
      this.enabled = true;
      if (this.fixed) this.el.classList.add('show', 'fixed');

      zoneEl.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
      window.addEventListener('pointermove', (e) => this._move(e), { passive: false });
      window.addEventListener('pointerup', (e) => this._up(e));
      window.addEventListener('pointercancel', (e) => this._up(e));
    }

    _center() {
      const b = this.el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }

    _down(e) {
      if (!this.enabled || this.pointer !== null) return;
      if (e.target.closest('.gbtn,.micbtn,.menubtn')) return;
      e.preventDefault();
      const ahora = performance.now();
      if (ahora - (this._lastDown || 0) < 300 && this.onDoubleTap) this.onDoubleTap();
      this._lastDown = ahora;
      this.pointer = e.pointerId;
      if (this.fixed) {
        const c = this._center();
        this.ox = c.x; this.oy = c.y;
        this.el.classList.add('active');
        this._track(e);                     // reacciona ya al primer toque
      } else {
        const r = this.zone.getBoundingClientRect();
        this.ox = e.clientX; this.oy = e.clientY;
        this.el.style.left = (e.clientX - r.left) + 'px';
        this.el.style.top = (e.clientY - r.top) + 'px';
        this.el.classList.add('show');
        this._apply(0, 0);
      }
    }

    _move(e) {
      if (e.pointerId !== this.pointer) return;
      e.preventDefault();
      this._track(e);
    }

    _track(e) {
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > MAX_R) { dx = (dx / d) * MAX_R; dy = (dy / d) * MAX_R; }
      this._apply(dx, dy);
    }

    _up(e) {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      if (this.fixed) this.el.classList.remove('active');
      else this.el.classList.remove('show');
      const lx = this.x, ly = this.y;
      this._apply(0, 0);
      if (this.onRelease) this.onRelease(lx, ly, Math.hypot(lx, ly));
    }

    _apply(dx, dy) {
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      const d = Math.hypot(dx, dy) / MAX_R;
      if (d < DEAD) { this.x = 0; this.y = 0; return; }
      // Fuera de la zona muerta se va directo al maximo: en un juego de cocina
      // interesa correr, no dosificar la velocidad con precision analogica.
      const k = Math.min(1, (d - DEAD) / 0.45) / (d || 1);
      this.x = (dx / MAX_R) * k;
      this.y = (dy / MAX_R) * k;
    }

    setEnabled(on) {
      this.enabled = on;
      if (!on) {
        this.pointer = null;
        if (!this.fixed) this.el.classList.remove('show');
        this.x = this.y = 0;
        this.knob.style.transform = 'translate(0,0)';
      }
    }
  }

  const Input = {
    move: null,
    aim: null,
    hold: false,
    onAct: null,
    onDash: null,
    onThrow: null,
    onChop: null,
    haptic: true,
    throwEnabled: true,
    throwMinMag: 0.6,   // por debajo de esto el joystick derecho solo apunta

    init() {
      this.move = new Stick(document.getElementById('zone-move'), document.getElementById('stick-move'), true);
      this.aim = new Stick(document.getElementById('zone-aim'), document.getElementById('stick-aim'), false);

      this.aim.onRelease = (x, y, mag) => {
        if (!this.throwEnabled || mag < this.throwMinMag) return;
        this.buzz(20);
        if (this.onThrow) this.onThrow(x, y);
      };

      // Un solo boton para todo. Lo que hace depende de lo que tengas delante:
      //  un toque       -> coger / soltar / servir
      //  toques seguidos-> cortar en la tabla
      //  mantener       -> fregar en el fregadero
      this._actionBtn(document.getElementById('btn-a'));

      // Correr: doble toque en el joystick de movimiento, para no gastar
      // otro boton en pantalla.
      this.move.onDoubleTap = () => { this.buzz(18); if (this.onDash) this.onDash(); };

      // teclado (util para probar en escritorio)
      const keys = {};
      const sync = () => {
        this.move.x = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0);
        this.move.y = (keys.s || keys.ArrowDown ? 1 : 0) - (keys.w || keys.ArrowUp ? 1 : 0);
      };
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        keys[e.key] = true;
        if (e.key === ' ') { e.preventDefault(); if (this.onAct) this.onAct(); }
        if (e.key === 'Shift') { if (this.onDash) this.onDash(); }
        if (e.key.toLowerCase() === 'e' && this.onChop) this.onChop();
        if (e.key.toLowerCase() === 'q' && this.onThrow) this.onThrow(this.move.x, this.move.y);
        sync();
      });
      window.addEventListener('keyup', (e) => { keys[e.key] = false; sync(); });
      return this;
    },

    _actionBtn(el) {
      let timer = null;
      const down = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('down');
        this.buzz(10);
        // La accion sale ya en el pointerdown: esperar a saber si es toque o
        // mantenido metia un retardo perceptible en lo que mas se usa.
        if (this.onAct) this.onAct();
        clearTimeout(timer);
        timer = setTimeout(() => { this.hold = true; el.classList.add('holding'); }, 240);
      };
      const up = () => {
        clearTimeout(timer);
        this.hold = false;
        el.classList.remove('down', 'holding');
      };
      el.addEventListener('pointerdown', down, { passive: false });
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    },

    buzz(ms) {
      if (this.haptic && navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
    },

    setAimEnabled(on) { if (this.aim) this.aim.setEnabled(on); },

    snapshot() {
      return {
        mx: +this.move.x.toFixed(3), my: +this.move.y.toFixed(3),
        ax: +this.aim.x.toFixed(3), ay: +this.aim.y.toFixed(3),
        hold: this.hold,
      };
    },

    reset() {
      this.hold = false;
      for (const s of [this.move, this.aim]) {
        if (!s) continue;
        s.x = s.y = 0; s.pointer = null;
        s.knob.style.transform = 'translate(0,0)';
        s.el.classList.remove('active');
        if (!s.fixed) s.el.classList.remove('show');
      }
    },
  };

  global.Input = Input;
})(window);
