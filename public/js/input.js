/* Controles tactiles: dos joysticks flotantes (mover / apuntar) + botones A, B, DASH. */
(function (global) {
  'use strict';

  const MAX_R = 52; // radio maximo del knob en px

  class Stick {
    constructor(zoneEl, stickEl) {
      this.zone = zoneEl;
      this.el = stickEl;
      this.knob = stickEl.querySelector('.knob');
      this.pointer = null;
      this.ox = 0; this.oy = 0;
      this.x = 0; this.y = 0;   // -1..1
      this.enabled = true;

      zoneEl.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
      window.addEventListener('pointermove', (e) => this._move(e), { passive: false });
      window.addEventListener('pointerup', (e) => this._up(e));
      window.addEventListener('pointercancel', (e) => this._up(e));
    }

    _down(e) {
      if (!this.enabled || this.pointer !== null) return;
      if (e.target.closest('.gbtn,.micbtn,.menubtn')) return;
      e.preventDefault();
      this.pointer = e.pointerId;
      const r = this.zone.getBoundingClientRect();
      this.ox = e.clientX - r.left;
      this.oy = e.clientY - r.top;
      this.el.style.left = this.ox + 'px';
      this.el.style.top = this.oy + 'px';
      this.el.classList.add('show');
      this._apply(0, 0);
    }

    _move(e) {
      if (e.pointerId !== this.pointer) return;
      e.preventDefault();
      const r = this.zone.getBoundingClientRect();
      let dx = e.clientX - r.left - this.ox;
      let dy = e.clientY - r.top - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > MAX_R) { dx = (dx / d) * MAX_R; dy = (dy / d) * MAX_R; }
      this._apply(dx, dy);
    }

    _up(e) {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.el.classList.remove('show');
      const lx = this.x, ly = this.y;
      this._apply(0, 0);
      // el gesto de soltar es lo que dispara el lanzamiento
      if (this.onRelease) this.onRelease(lx, ly, Math.hypot(lx, ly));
    }

    _apply(dx, dy) {
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      // zona muerta del 18%
      const d = Math.hypot(dx, dy) / MAX_R;
      if (d < 0.18) { this.x = 0; this.y = 0; return; }
      const k = Math.min(1, (d - 0.18) / 0.82) / (d || 1);
      this.x = (dx / MAX_R) * k;
      this.y = (dy / MAX_R) * k;
    }

    setEnabled(on) {
      this.enabled = on;
      if (!on) { this.pointer = null; this.el.classList.remove('show'); this.x = this.y = 0; }
    }
  }

  const Input = {
    move: null,
    aim: null,
    hold: false,
    onAct: null,
    onDash: null,
    onThrow: null,
    haptic: true,
    throwEnabled: true,
    throwMinMag: 0.6,   // por debajo de esto el joystick derecho solo apunta

    init() {
      this.move = new Stick(document.getElementById('zone-move'), document.getElementById('stick-move'));
      this.aim = new Stick(document.getElementById('zone-aim'), document.getElementById('stick-aim'));

      this.aim.onRelease = (x, y, mag) => {
        if (!this.throwEnabled || mag < this.throwMinMag) return;
        this.buzz(20);
        if (this.onThrow) this.onThrow(x, y);
      };

      const a = document.getElementById('btn-a');
      const b = document.getElementById('btn-b');
      const dash = document.getElementById('btn-dash');

      this._tap(a, () => { this.buzz(12); if (this.onAct) this.onAct(); });
      this._tap(dash, () => { this.buzz(18); if (this.onDash) this.onDash(); });
      this._holdBtn(b);

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
        if (e.key.toLowerCase() === 'e') this.hold = true;
        if (e.key.toLowerCase() === 'q' && this.onThrow) this.onThrow(this.move.x, this.move.y);
        sync();
      });
      window.addEventListener('keyup', (e) => {
        keys[e.key] = false;
        if (e.key.toLowerCase() === 'e') this.hold = false;
        sync();
      });
      return this;
    },

    _tap(el, fn) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('down'); fn();
      }, { passive: false });
      const off = () => el.classList.remove('down');
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    },

    _holdBtn(el) {
      const on = (e) => { e.preventDefault(); e.stopPropagation(); this.hold = true; el.classList.add('down'); this.buzz(8); };
      const off = () => { this.hold = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on, { passive: false });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
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
      if (this.move) { this.move.x = this.move.y = 0; this.move.pointer = null; this.move.el.classList.remove('show'); }
      if (this.aim) { this.aim.x = this.aim.y = 0; this.aim.pointer = null; this.aim.el.classList.remove('show'); }
    },
  };

  global.Input = Input;
})(window);
