/*
 * Renderizado 2.5D del mapa Negi Sushi.
 *
 * La rejilla se dibuja en perspectiva 3/4: las casillas son mas anchas que
 * altas (SQUASH) y los muebles se levantan del suelo con una cara superior y
 * un lateral sombreado. No es 3D real, pero da el mismo volumen y permite
 * seguir razonando en coordenadas de casilla para colisiones e interaccion.
 *
 * La camara sigue al cocinero local con zoom, en vez de encajar todo el mapa:
 * asi las casillas se ven grandes y el personaje cerca.
 */
(function (global) {
  'use strict';

  const LEGEND = {
    '#': 'wall', '.': 'floor', 'C': 'counter', 'B': 'board', 'K': 'cooker',
    'D': 'plates', 'W': 'sink', 'X': 'return', 'T': 'trash', 'V': 'serve',
    'N': 'crate', 'R': 'crate', 'P': 'crate', 'G': 'crate', 'S': 'crate',
  };
  const CRATE_ING = { N: 'nori', R: 'rice', P: 'cucumber', G: 'shrimp', S: 'salmon' };
  const SOLID = new Set(['wall', 'counter', 'board', 'cooker', 'plates', 'sink', 'return', 'trash', 'serve', 'crate']);

  const TEAM_PALETTES = {
    A: ['#e8443c', '#ef8a2b', '#d9b310'],
    B: ['#2f8fe0', '#6a4bd6', '#12a89a'],
  };
  const chefColor = (team, slot) => {
    const p = TEAM_PALETTES[team] || TEAM_PALETTES.A;
    return p[slot % p.length];
  };

  const SQUASH = 0.72;        // alto/ancho de cada casilla (perspectiva 3/4)
  const BLOCK = 0.50;         // altura de los muebles, en anchos de casilla
  const PAD_TOP = 26;         // hueco para el HUD (solo ocupa las esquinas)
  const PAD = 6;

  // Paleta de la cocina
  const C = {
    tileA: '#e6ddc9', tileB: '#dbd0b8', grout: 'rgba(120,102,72,.16)',
    woodTop: '#e9b26a', woodFace: '#b87b33', woodEdge: '#f7d4a1',
    steelTop: '#c3cad9', steelFace: '#7e879b',
    darkTop: '#2c3040', darkFace: '#171a24',
    wallTop: '#3c4459', wallFace: '#222736',
  };

  const Render = {
    cv: null, ctx: null, dpr: 1, cw: 0, chh: 0,
    map: null, cells: null, ing: null, recipes: null,
    tw: 40, th: 32, bh: 20,
    cam: { x: 11, y: 6.5 },
    pops: [], overlays: [], t: 0,
    meId: null, myTeam: 'A',
    aim: { x: 0, y: 0, active: false, canThrow: false },
    throwRange: 7,
    scenery: null,
    _floor: null,

    init(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      window.addEventListener('resize', () => this.resize());
      if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
      this.resize();
      return this;
    },

    setMap(map, ingredients, recipes) {
      this.map = map;
      this.ing = ingredients;
      this.recipes = {};
      (recipes || []).forEach((r) => { this.recipes[r.id] = r; });
      this.cells = [];
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          const ch = map.layout[y][x];
          this.cells.push({ x, y, ch, type: LEGEND[ch] || 'floor', ing: CRATE_ING[ch] || null });
        }
      }
      this.cam.x = map.w / 2;
      this.cam.y = map.h / 2;
      this.scenery = buildScenery(map);
      this.pops.length = 0;
      this._floor = null;
      this.resize();
    },

    cellAt(x, y) {
      if (!this.map || x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
      return this.cells[y * this.map.w + x];
    },
    solidAt(x, y) {
      const c = this.cellAt(x, y);
      return !c || SOLID.has(c.type);
    },

    resize() {
      if (!this.cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = this.cv.clientWidth || window.innerWidth;
      const h = this.cv.clientHeight || window.innerHeight;
      this.dpr = dpr; this.cw = w; this.chh = h;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      if (!this.map) return;
      // La cocina entera tiene que caber en pantalla: el tamano de casilla es
      // el mayor que lo permite. Por eso el mapa es compacto.
      // Se deja un margen a los lados para que asome el comedor.
      const lado = Math.max(PAD, w * 0.045);
      this.tw = Math.min((w - lado * 2) / this.map.w, (h - PAD_TOP - PAD) / (this.map.h * SQUASH));
      this.th = this.tw * SQUASH;
      this.bh = this.tw * BLOCK;
      this.cam.x = this.map.w / 2;
      this.cam.y = this.map.h / 2;
      this._floor = null;
    },

    // --------------------------------------------------------- coordenadas
    sx(x) { return (x - this.cam.x) * this.tw + this.cw / 2; },
    sy(y) { return (y - this.cam.y) * this.th + this.chh / 2 + PAD_TOP / 2; },

    /**
     * Camara fija centrada: se ve la cocina entera de un vistazo, que es lo
     * que hace falta para coordinarse con el equipo. No persigue a nadie.
     */
    follow() {
      if (!this.map) return;
      this.cam.x = this.map.w / 2;
      this.cam.y = this.map.h / 2;
    },

    // -------------------------------------------------------------- helpers
    rr(x, y, w, h, r) {
      const ctx = this.ctx;
      const rad = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    },
    glyph(txt, px, py, size) {
      const ctx = this.ctx;
      ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, px, py);
    },
    shadow(cx, cy, rx, alpha) {
      const ctx = this.ctx;
      ctx.fillStyle = `rgba(20,14,6,${alpha})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.42, 0, 0, 7); ctx.fill();
    },

    /** Mueble con volumen: lateral + cara superior levantada. */
    block(x, y, faceCol, topCol, r) {
      const ctx = this.ctx;
      const px = this.sx(x), py = this.sy(y);
      const w = this.tw, h = this.th, bh = this.bh;
      ctx.fillStyle = faceCol;
      this.rr(px, py - bh + h * 0.25, w, h * 0.75 + bh, r || 4);
      ctx.fill();
      ctx.fillStyle = topCol;
      this.rr(px, py - bh, w, h, r || 4);
      ctx.fill();
      return { px, py: py - bh, w, h };
    },

    // ------------------------------------------------------------- escenario
    drawScenery() {
      const ctx = this.ctx;
      // suelo del local, fuera de la cocina
      ctx.fillStyle = '#2a2233';
      ctx.fillRect(0, 0, this.cw, this.chh);
      const g = ctx.createRadialGradient(this.cw / 2, this.chh / 2, this.tw, this.cw / 2, this.chh / 2, this.cw * 0.8);
      g.addColorStop(0, 'rgba(255,190,120,.10)');
      g.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cw, this.chh);

      const s = this.scenery;
      if (!s) return;
      for (const m of s.mesas) this.drawMesa(m);
      for (const w of s.camareros) this.drawCamarero(w);
    },

    drawMesa(m) {
      const ctx = this.ctx;
      const cx = this.sx(m.x), cy = this.sy(m.y);
      if (cx < -120 || cx > this.cw + 120 || cy < -120 || cy > this.chh + 120) return;
      const r = this.tw * 0.44;
      this.shadow(cx, cy + r * 0.5, r * 1.05, 0.35);
      // comensales
      m.sillas.forEach((a, i) => {
        const px = cx + Math.cos(a) * r * 1.35, py = cy + Math.sin(a) * r * 1.0;
        this.drawComensal(px, py, m.colores[i], m.seed + i);
      });
      // tablero
      ctx.fillStyle = '#5a3320';
      this.rr(cx - r, cy - r * 0.72 + 4, r * 2, r * 1.5, r * 0.5); ctx.fill();
      ctx.fillStyle = '#7d4a2c';
      this.rr(cx - r, cy - r * 0.8, r * 2, r * 1.5, r * 0.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      this.rr(cx - r * 0.8, cy - r * 0.62, r * 1.6, r * 0.34, r * 0.17); ctx.fill();
      // platos servidos
      ctx.fillStyle = '#eee9dd';
      ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.1, r * 0.3, r * 0.2, 0, 0, 7); ctx.fill();
    },

    drawComensal(px, py, col, seed) {
      const ctx = this.ctx;
      const r = this.tw * 0.2;
      const bob = Math.sin(this.t * 2 + seed) * r * 0.09;
      this.shadow(px, py + r * 0.9, r * 0.8, 0.28);
      ctx.fillStyle = col;
      this.rr(px - r * 0.7, py - r * 0.2 + bob, r * 1.4, r * 1.2, r * 0.5); ctx.fill();
      ctx.fillStyle = '#f0c9a8';
      ctx.beginPath(); ctx.arc(px, py - r * 0.75 + bob, r * 0.55, 0, 7); ctx.fill();
      ctx.fillStyle = '#2b2119';
      ctx.beginPath(); ctx.arc(px, py - r * 1.05 + bob, r * 0.56, Math.PI, 0); ctx.fill();
    },

    drawCamarero(w) {
      const ctx = this.ctx;
      const p = w.puntos[w.i];
      const q = w.puntos[(w.i + 1) % w.puntos.length];
      const x = p.x + (q.x - p.x) * w.t;
      const y = p.y + (q.y - p.y) * w.t;
      const cx = this.sx(x), cy = this.sy(y);
      if (cx < -120 || cx > this.cw + 120 || cy < -120 || cy > this.chh + 120) return;
      const r = this.tw * 0.24;
      const paso = Math.sin(this.t * 8 + w.seed) * r * 0.16;
      this.shadow(cx, cy + r * 1.0, r * 0.85, 0.32);
      // cuerpo con chaleco
      ctx.fillStyle = '#20242e';
      this.rr(cx - r * 0.68, cy - r * 0.3 + paso * 0.3, r * 1.36, r * 1.35, r * 0.45); ctx.fill();
      ctx.fillStyle = '#f4f1e8';
      this.rr(cx - r * 0.22, cy - r * 0.3 + paso * 0.3, r * 0.44, r * 1.0, r * 0.18); ctx.fill();
      // cabeza
      ctx.fillStyle = '#e8b990';
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.85 + paso * 0.3, r * 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(cx, cy - r * 1.1 + paso * 0.3, r * 0.51, Math.PI, 0); ctx.fill();
      // bandeja
      ctx.fillStyle = '#cfd6e2';
      ctx.beginPath(); ctx.ellipse(cx + r * 0.85, cy - r * 0.55 - paso, r * 0.42, r * 0.18, 0, 0, 7); ctx.fill();
    },

    stepScenery(dt) {
      const s = this.scenery;
      if (!s) return;
      for (const w of s.camareros) {
        w.t += dt * w.vel;
        while (w.t >= 1) { w.t -= 1; w.i = (w.i + 1) % w.puntos.length; }
      }
    },

    // --------------------------------------------------------------- cocina
    drawFloor() {
      const ctx = this.ctx;
      const x0 = Math.max(0, Math.floor(this.cam.x - this.cw / this.tw / 2) - 1);
      const x1 = Math.min(this.map.w - 1, Math.ceil(this.cam.x + this.cw / this.tw / 2) + 1);
      const y0 = Math.max(0, Math.floor(this.cam.y - this.chh / this.th / 2) - 1);
      const y1 = Math.min(this.map.h - 1, Math.ceil(this.cam.y + this.chh / this.th / 2) + 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const c = this.cellAt(x, y);
          if (!c || c.type === 'wall') continue;
          const px = this.sx(x), py = this.sy(y);
          ctx.fillStyle = (x + y) % 2 ? C.tileA : C.tileB;
          ctx.fillRect(px, py, this.tw + 0.6, this.th + 0.6);
          ctx.strokeStyle = C.grout;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, this.tw, this.th);
        }
      }
      // alfombra
      (this.map.deco || []).filter((d) => d.type === 'rug').forEach((d) => {
        ctx.fillStyle = '#7a2036';
        this.rr(this.sx(d.x), this.sy(d.y), d.w * this.tw, d.h * this.th, 6); ctx.fill();
        ctx.strokeStyle = '#c8a24a'; ctx.lineWidth = 2;
        this.rr(this.sx(d.x) + 4, this.sy(d.y) + 4, d.w * this.tw - 8, d.h * this.th - 8, 4); ctx.stroke();
      });
    },

    /** Los muebles se pintan por filas para que los de delante tapen a los de atras. */
    drawRowBlocks(y) {
      for (let x = 0; x < this.map.w; x++) {
        const c = this.cellAt(x, y);
        if (!c || !SOLID.has(c.type)) continue;
        const px = this.sx(x);
        if (px < -this.tw * 2 || px > this.cw + this.tw * 2) continue;
        this.drawBlock(c);
      }
    },

    drawBlock(c) {
      const ctx = this.ctx, s = this.tw;
      let b;
      switch (c.type) {
        case 'wall':
          b = this.block(c.x, c.y, C.wallFace, C.wallTop, 3);
          ctx.fillStyle = 'rgba(255,255,255,.06)';
          ctx.fillRect(b.px + 2, b.py + 2, b.w - 4, 2);
          break;

        case 'counter':
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          ctx.strokeStyle = C.woodEdge; ctx.lineWidth = 2;
          this.rr(b.px + 3, b.py + 3, b.w - 6, b.h - 6, 4); ctx.stroke();
          break;

        case 'board':
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          ctx.fillStyle = '#c7855a';
          this.rr(b.px + s * 0.1, b.py + s * 0.08, s * 0.8, b.h - s * 0.14, 4); ctx.fill();
          ctx.strokeStyle = '#a2673f'; ctx.lineWidth = 1.5;
          for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(b.px + s * 0.14, b.py + s * 0.08 + i * (b.h - s * 0.14) / 4);
            ctx.lineTo(b.px + s * 0.86, b.py + s * 0.08 + i * (b.h - s * 0.14) / 4);
            ctx.stroke();
          }
          break;

        case 'crate': {
          b = this.block(c.x, c.y, '#8a5a26', '#c1893f', 5);
          ctx.strokeStyle = 'rgba(70,42,14,.55)'; ctx.lineWidth = 2;
          this.rr(b.px + 4, b.py + 4, b.w - 8, b.h - 8, 3); ctx.stroke();
          const meta = this.ing[c.ing];
          ctx.fillStyle = meta.color;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h * 0.46, s * 0.3, s * 0.22, 0, 0, 7); ctx.fill();
          this.glyph(meta.emoji, b.px + b.w / 2, b.py + b.h * 0.44, s * 0.5);
          break;
        }

        case 'cooker':
          b = this.block(c.x, c.y, C.steelFace, C.steelTop, 5);
          ctx.fillStyle = '#3a4152';
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.32, s * 0.24, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = '#e2e8f5'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.32, s * 0.24, 0, 0, 7); ctx.stroke();
          break;

        case 'plates':
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          break;

        case 'sink':
          b = this.block(c.x, c.y, '#5b6274', '#848da2', 5);
          ctx.fillStyle = '#28404f';
          this.rr(b.px + 4, b.py + 4, b.w - 8, b.h - 8, 5); ctx.fill();
          ctx.fillStyle = '#63c8ec';
          this.rr(b.px + 7, b.py + 7, b.w - 14, b.h - 14, 4); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.5)';
          this.rr(b.px + 10, b.py + 9, b.w * 0.3, 3, 2); ctx.fill();
          break;

        case 'return':
          b = this.block(c.x, c.y, C.woodFace, '#b58c56', 5);
          ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.28, s * 0.2, 0, 0, 7); ctx.stroke();
          break;

        case 'trash':
          b = this.block(c.x, c.y, '#12141b', '#252a36', 5);
          ctx.fillStyle = '#0a0c11';
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.3, s * 0.21, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = '#4a5162'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.33, s * 0.24, 0, 0, 7); ctx.stroke();
          break;

        case 'serve':
          b = this.block(c.x, c.y, '#0b0d14', C.darkTop, 4);
          ctx.fillStyle = '#f5f2e8';
          this.glyph('\u{1F41F}', b.px + b.w / 2, b.py + b.h / 2, s * 0.5);
          ctx.fillStyle = 'rgba(255,209,102,.85)';
          this.rr(b.px + 2, b.py + b.h - 5, b.w - 4, 3, 1.5); ctx.fill();
          break;

        default: break;
      }
    },

    drawSign() {
      const d = (this.map.deco || []).find((x) => x.type === 'sign');
      if (!d) return;
      const ctx = this.ctx;
      const x = this.sx(d.x), y = this.sy(d.y) - this.bh * 1.1;
      const w = d.w * this.tw, h = d.h * this.th * 1.1;
      ctx.fillStyle = '#0a1420';
      this.rr(x, y, w, h, 5); ctx.fill();
      ctx.save();
      ctx.strokeStyle = '#3ad9ff'; ctx.lineWidth = 2;
      ctx.shadowColor = '#3ad9ff'; ctx.shadowBlur = 12;
      this.rr(x + 2, y + 2, w - 4, h - 4, 4); ctx.stroke();
      ctx.fillStyle = '#c4f3ff';
      ctx.font = `700 ${Math.max(9, h * 0.5)}px ui-monospace,Consolas,monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.text, x + w / 2, y + h / 2);
      ctx.restore();
    },

    // ---------------------------------------------------------------- frame
    draw(view, dt) {
      const ctx = this.ctx;
      this.t += dt;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.chh);
      if (!this.map) { ctx.fillStyle = '#101119'; ctx.fillRect(0, 0, this.cw, this.chh); return; }

      this.stepScenery(dt);
      this.drawScenery();
      this.drawFloor();

      const chefs = (view && view.chefs) || [];
      const tiles = (view && view.tiles) || {};
      this.overlays.length = 0;

      if (view) { this.drawGround(view.gnd); this.drawAim(view); this.drawTarget(view); }

      // pintado por filas: muebles de la fila, luego cocineros que pisan esa fila
      for (let y = 0; y < this.map.h; y++) {
        this.drawRowBlocks(y);
        this.drawTileRow(y, tiles);
        for (const ch of chefs) {
          if (Math.floor(ch.y) === y) this.drawChef(ch);
        }
      }

      this.drawSign();
      if (view) this.drawFlying(view.fly);
      this.drawOverlays();
      this.drawPops(dt);
    },

    drawOverlays() {
      for (const o of this.overlays) {
        if (o.kind === 'bar') this.bar(o.x, o.y, o.w, o.h, o.p, o.col);
        else { this.ctx.fillStyle = o.col; this.glyph(o.text, o.x, o.y, o.size); }
      }
      this.overlays.length = 0;
    },

    drawTileRow(row, tiles) {
      const ctx = this.ctx, s = this.tw;
      for (const key in tiles) {
        const i = +key;
        const c = this.cells[i];
        if (!c || c.y !== row) continue;
        const st = tiles[key];
        const px = this.sx(c.x), py = this.sy(c.y) - this.bh;
        const cx = px + this.tw / 2, cy = py + this.th / 2;
        if (px < -s * 2 || px > this.cw + s * 2) continue;

        const barAt = (p, col) => this.overlays.push({ kind: 'bar', x: px + s * 0.12, y: py - 9, w: s * 0.76, h: 6, p, col });
        const iconAt = (text, col) => this.overlays.push({ kind: 'icon', text, col, x: cx, y: py - 10, size: s * 0.42 });

        if (c.type === 'counter' || c.type === 'board') {
          if (st.i) this.drawItem(st.i, cx, cy - s * 0.06, s * 0.8, st.p);
          if (st.p > 0) barAt(st.p, '#ffd166');
        } else if (c.type === 'cooker') {
          const pot = st.pot;
          const col = pot.s === 'burnt' ? '#3d2b1d' : pot.s === 'cooked' ? '#fffdf4' : '#efe9d8';
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.24, s * 0.17, 0, 0, 7); ctx.fill();
          if (pot.s === 'cooking') {
            barAt(pot.p, '#ff9f43');
            // vapor
            ctx.fillStyle = 'rgba(255,255,255,.22)';
            for (let k = 0; k < 3; k++) {
              const ph = (this.t * 0.8 + k * 0.33) % 1;
              ctx.beginPath();
              ctx.arc(cx + Math.sin((this.t + k) * 2) * s * 0.08, cy - ph * s * 0.7, s * 0.07 * (1 - ph * 0.5), 0, 7);
              ctx.fill();
            }
          } else if (pot.s === 'cooked') {
            barAt(pot.p, '#ff5f5a');
            if (Math.sin(this.t * 8) > 0) iconAt('✔', '#49d78a');
          } else if (pot.s === 'burnt') {
            iconAt('\u{1F525}', '#ff5f5a');
          }
        } else if (c.type === 'sink') {
          if (st.d) this.drawPlateStack(cx - s * 0.15, cy, s * 0.5, st.d, true);
          if (st.c) this.drawPlateStack(cx + s * 0.17, cy, s * 0.5, st.c, false);
          if (st.p > 0) barAt(st.p, '#63c8ec');
        } else if (c.type === 'return') {
          if (st.d) this.drawPlateStack(cx, cy, s * 0.62, st.d, true);
        } else if (c.type === 'plates') {
          if (st.n > 0) this.drawPlateStack(cx, cy, s * 0.68, st.n, false);
          else { ctx.fillStyle = '#8a6a3a'; this.glyph('∅', cx, cy, s * 0.45); }
        }
      }
    },

    drawPlateStack(cx, cy, size, n, dirty) {
      const ctx = this.ctx;
      const k = Math.min(n, 4);
      for (let i = 0; i < k; i++) {
        const y = cy - i * (size * 0.10);
        ctx.fillStyle = dirty ? '#9c9078' : '#f6f4ee';
        ctx.beginPath(); ctx.ellipse(cx, y, size * 0.5, size * 0.28, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = dirty ? '#6f6650' : '#cdd1d9'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      if (n > 4) {
        ctx.fillStyle = '#20232e';
        ctx.font = `700 ${size * 0.34}px ui-sans-serif,system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('x' + n, cx, cy - k * size * 0.1 - size * 0.16);
      }
    },

    /**
     * Un ingrediente. Al cortarlo no cambia de icono: se parte en trozos, que
     * es la forma de que se vea de un golpe si ya esta listo.
     */
    drawItem(item, cx, cy, size, prog) {
      const ctx = this.ctx;
      if (!item) return;

      if (item.k === 'p') {
        ctx.fillStyle = item.d ? '#9c9078' : '#f6f4ee';
        ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.5, size * 0.3, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = item.d ? '#6f6650' : '#c8ccd4'; ctx.lineWidth = 1.4; ctx.stroke();
        if (item.d) { this.glyph('\u{1F4A6}', cx, cy, size * 0.36); return; }
        const n = item.c.length;
        item.c.forEach((t, i) => {
          const a = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
          const r = n === 1 ? 0 : size * 0.19;
          this.glyph(this.ing[t].emoji, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, size * (n > 2 ? 0.36 : 0.42));
        });
        return;
      }

      const meta = this.ing[item.t];
      const sz = size * 0.62;

      if (item.s === 'burnt') {
        ctx.fillStyle = '#241a12';
        ctx.beginPath(); ctx.ellipse(cx, cy, sz * 0.45, sz * 0.32, 0, 0, 7); ctx.fill();
        this.glyph('\u{1F525}', cx, cy - sz * 0.1, sz * 0.6);
        return;
      }

      if (item.s === 'chopped') {
        // tres trozos separados
        for (let i = 0; i < 3; i++) {
          const dx = (i - 1) * sz * 0.3;
          this.glyph(meta.emoji, cx + dx, cy + (i === 1 ? -sz * 0.06 : 0), sz * 0.46);
        }
        return;
      }

      if (item.s === 'cooked') {
        ctx.fillStyle = 'rgba(255,240,200,.3)';
        ctx.beginPath(); ctx.ellipse(cx, cy, sz * 0.5, sz * 0.35, 0, 0, 7); ctx.fill();
        this.glyph(meta.emoji, cx, cy, sz);
        return;
      }

      // crudo: si esta a medio cortar, se va separando
      const p = prog || 0;
      if (p > 0) {
        const sep = sz * 0.34 * p;
        this.glyph(meta.emoji, cx - sep, cy, sz * (1 - p * 0.22));
        this.glyph(meta.emoji, cx + sep, cy, sz * (1 - p * 0.22));
      } else {
        this.glyph(meta.emoji, cx, cy, sz);
      }
    },

    drawGround(list) {
      if (!list || !list.length) return;
      const ctx = this.ctx, s = this.tw;
      for (const g of list) {
        const px = this.sx(g.x), py = this.sy(g.y);
        this.shadow(px, py, s * 0.22, 0.25);
        ctx.save(); ctx.globalAlpha = 0.9;
        this.drawItem(g.i, px, py - s * 0.06, s * 0.62, 0);
        ctx.restore();
      }
    },

    drawFlying(list) {
      if (!list || !list.length) return;
      const ctx = this.ctx, s = this.tw;
      for (const f of list) {
        const px = this.sx(f.x), py = this.sy(f.y);
        const h = Math.sin(Math.min(1, f.p) * Math.PI) * s * 0.9;
        this.shadow(px, py, s * 0.18, 0.3);
        ctx.save();
        ctx.translate(px, py - h);
        ctx.rotate(this.t * 8);
        this.drawItem(f.i, 0, 0, s * 0.78, 0);
        ctx.restore();
      }
    },

    drawAim(view) {
      if (!this.aim.active || !this.aim.canThrow) return;
      const me = (view.chefs || []).find((c) => c.id === this.meId);
      if (!me) return;
      const m = Math.hypot(this.aim.x, this.aim.y);
      if (m < 0.15) return;
      const ux = this.aim.x / m, uy = this.aim.y / m;
      let d = 0.35, px = me.x + ux * d, py = me.y + uy * d;
      while (d < this.throwRange) {
        const nx = me.x + ux * (d + 0.15), ny = me.y + uy * (d + 0.15);
        if (this.solidAt(Math.floor(nx), Math.floor(ny))) break;
        px = nx; py = ny; d += 0.15;
      }
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,209,102,.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -this.t * 26;
      ctx.beginPath();
      ctx.moveTo(this.sx(me.x), this.sy(me.y));
      ctx.lineTo(this.sx(px), this.sy(py));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.ellipse(this.sx(px), this.sy(py), this.tw * 0.24, this.th * 0.24, 0, 0, 7); ctx.stroke();
      ctx.restore();
    },

    drawTarget(view) {
      const me = (view.chefs || []).find((c) => c.id === this.meId);
      if (!me) return;
      const d = 0.34 + 0.45;
      const tx = Math.floor(me.x + me.fx * d), ty = Math.floor(me.y + me.fy * d);
      const c = this.cellAt(tx, ty);
      if (!c || !SOLID.has(c.type) || c.type === 'wall') return;
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.55 + Math.sin(this.t * 7) * 0.25;
      this.rr(this.sx(tx) + 2, this.sy(ty) - this.bh + 2, this.tw - 4, this.th - 4, 5);
      ctx.stroke();
      ctx.restore();
    },

    // ------------------------------------------------------------ cocinero
    drawChef(ch) {
      const ctx = this.ctx;
      const s = this.tw;
      const px = this.sx(ch.x), py = this.sy(ch.y);
      const col = chefColor(this.myTeam, ch.s);
      const r = s * 0.3;
      const mirando = ch.fy < -0.35 ? 'arriba' : ch.fy > 0.35 ? 'abajo' : 'lado';
      const flip = ch.fx < 0 ? -1 : 1;
      const andando = (ch.v || 0) > 0.4;
      const paso = andando ? Math.sin(this.t * 13) : 0;
      const bob = Math.abs(paso) * r * 0.13;

      this.shadow(px, py + r * 0.34, r * 0.95, 0.34);

      if (ch.d) {  // estela del esprint
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px - ch.fx * r * 1.2, py - ch.fy * r * 0.7 - r, r * 0.9, 0, 7);
        ctx.stroke();
      }

      const baseY = py - r * 0.5 - bob;

      // piernas
      ctx.fillStyle = '#2b3040';
      ctx.fillRect(px - r * 0.42, baseY + r * 0.42, r * 0.34, r * 0.55 + paso * r * 0.16);
      ctx.fillRect(px + r * 0.08, baseY + r * 0.42, r * 0.34, r * 0.55 - paso * r * 0.16);
      ctx.fillStyle = '#1a1d27';
      ctx.fillRect(px - r * 0.46, baseY + r * 0.93 + paso * r * 0.16, r * 0.42, r * 0.16);
      ctx.fillRect(px + r * 0.04, baseY + r * 0.93 - paso * r * 0.16, r * 0.42, r * 0.16);

      // cuerpo: chaquetilla blanca con delantal del color del equipo
      ctx.fillStyle = '#f7f5ee';
      this.rr(px - r * 0.72, baseY - r * 0.5, r * 1.44, r * 1.05, r * 0.34); ctx.fill();
      ctx.fillStyle = col;
      this.rr(px - r * 0.42, baseY - r * 0.16, r * 0.84, r * 0.72, r * 0.16); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      this.rr(px - r * 0.72, baseY + r * 0.36, r * 1.44, r * 0.2, r * 0.1); ctx.fill();

      // brazos
      ctx.fillStyle = '#f2efe6';
      const braz = paso * r * 0.2;
      ctx.beginPath(); ctx.ellipse(px - r * 0.78, baseY - r * 0.06 + braz, r * 0.2, r * 0.3, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px + r * 0.78, baseY - r * 0.06 - braz, r * 0.2, r * 0.3, 0, 0, 7); ctx.fill();

      // cabeza
      const hy = baseY - r * 0.92;
      ctx.fillStyle = '#f0c9a3';
      ctx.beginPath(); ctx.arc(px, hy, r * 0.52, 0, 7); ctx.fill();

      // gorro de cocinero
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(px, hy - r * 0.62, r * 0.62, r * 0.42, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px - r * 0.32, hy - r * 0.52, r * 0.3, r * 0.28, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px + r * 0.32, hy - r * 0.52, r * 0.3, r * 0.28, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#eceae2';
      this.rr(px - r * 0.56, hy - r * 0.4, r * 1.12, r * 0.3, r * 0.1); ctx.fill();
      ctx.fillStyle = col;
      this.rr(px - r * 0.56, hy - r * 0.18, r * 1.12, r * 0.13, r * 0.06); ctx.fill();

      // cara segun hacia donde mira
      if (mirando !== 'arriba') {
        ctx.fillStyle = '#2a2019';
        const ex = mirando === 'lado' ? r * 0.14 * flip : 0;
        ctx.beginPath(); ctx.ellipse(px - r * 0.19 + ex, hy + r * 0.02, r * 0.075, r * 0.1, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(px + r * 0.19 + ex, hy + r * 0.02, r * 0.075, r * 0.1, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#b9846a'; ctx.lineWidth = Math.max(1, r * 0.06); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(px + ex * 0.6, hy + r * 0.2, r * 0.14, 0.25, Math.PI - 0.25); ctx.stroke();
      }

      // objeto en las manos, delante del pecho
      if (ch.h) {
        const iy = baseY - r * 0.1;
        this.shadow(px, baseY + r * 0.3, r * 0.4, 0.15);
        this.drawItem(ch.h, px, iy, s * 0.62, 0);
      }

      // cuchillo cuando esta cortando
      if (ch.c) {
        ctx.save();
        ctx.translate(px + r * 0.75 * (flip || 1), baseY - r * 0.35);
        ctx.rotate(-0.5 * flip);
        ctx.fillStyle = '#d9dee9';
        ctx.fillRect(-r * 0.06, -r * 0.5, r * 0.12, r * 0.55);
        ctx.fillStyle = '#5a3b23';
        ctx.fillRect(-r * 0.08, r * 0.03, r * 0.16, r * 0.22);
        ctx.restore();
      }

      // nombre
      const label = ch.b ? '\u{1F916} ' + ch.n : ch.n;
      ctx.font = `700 ${Math.max(9, s * 0.24)}px ui-sans-serif,system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.strokeText(label, px, py + r * 0.95);
      ctx.fillStyle = ch.id === this.meId ? '#ffd166' : ch.b ? '#c3c9d8' : '#f2f0e8';
      ctx.fillText(label, px, py + r * 0.95);

      // flecha bajo tu propio cocinero
      if (ch.id === this.meId) {
        ctx.fillStyle = 'rgba(255,209,102,.95)';
        const ay = py - r * 2.7 + Math.sin(this.t * 4) * r * 0.12;
        ctx.beginPath();
        ctx.moveTo(px, ay + r * 0.34); ctx.lineTo(px - r * 0.26, ay); ctx.lineTo(px + r * 0.26, ay);
        ctx.closePath(); ctx.fill();
      }
    },

    bar(x, y, w, h, p, col) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(10,8,4,.6)';
      this.rr(x, y, w, h, h / 2); ctx.fill();
      ctx.fillStyle = col;
      this.rr(x + 1.5, y + 1.5, Math.max(0, (w - 3) * Math.min(1, p)), h - 3, (h - 3) / 2); ctx.fill();
    },

    addEvents(evts) {
      const texts = {
        serve: null, bad: null, trash: '\u{1F5D1}', chop: '✂', wash: '✨',
        ready: '\u{1F514}', burn: '\u{1F525}', add: '+', hint: '?', expire: null,
        throw: '\u{1F4A8}', catch: '\u{1F44F}', land: '⬇', tap: null,
      };
      (evts || []).forEach((e) => {
        if (e.e === 'expire') return;
        if (e.e === 'tap') {                       // chispa corta de cada tajo
          this.pops.push({ x: e.x, y: e.y, life: 0.45, text: '✦', col: '#ffe6a0', small: true });
          return;
        }
        this.pops.push({
          x: e.x, y: e.y, life: 1,
          text: e.s || texts[e.e] || '',
          col: e.e === 'serve' || e.e === 'catch' ? '#49d78a' : e.e === 'bad' ? '#ff6b6b' : '#ffffff',
        });
      });
    },

    drawPops(dt) {
      const ctx = this.ctx, s = this.tw;
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const p = this.pops[i];
        p.life -= dt * (p.small ? 2.4 : 1.1);
        if (p.life <= 0) { this.pops.splice(i, 1); continue; }
        const a = Math.min(1, p.life * 1.6);
        const px = this.sx(p.x), py = this.sy(p.y) - this.bh - (1 - p.life) * s * 0.7;
        ctx.globalAlpha = a;
        ctx.font = `800 ${Math.max(10, s * (p.small ? 0.3 : 0.38))}px ui-sans-serif,system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.65)';
        ctx.strokeText(p.text, px, py);
        ctx.fillStyle = p.col;
        ctx.fillText(p.text, px, py);
        ctx.globalAlpha = 1;
      }
    },
  };

  /**
   * Comedor alrededor de la cocina. Con la cocina entera en pantalla apenas
   * queda margen, asi que las mesas se pegan a los muros para que asomen por
   * los bordes: se lee como que el local sigue mas alla.
   */
  function buildScenery(map) {
    const mesas = [];
    const cols = ['#c8564b', '#4b7ec8', '#48a06a', '#c8a24a', '#8a5fc0', '#d0793f'];
    const puestos = [
      [-0.75, 2.0], [-0.75, 5.2], [-0.75, 7.6],
      [map.w + 0.75, 1.6], [map.w + 0.75, 4.2], [map.w + 0.75, 7.2],
      [3.0, -0.8], [7.5, -0.8], [11.5, -0.8],
      [2.5, map.h + 0.8], [7.0, map.h + 0.8], [11.0, map.h + 0.8],
    ];
    puestos.forEach((p, i) => {
      const n = 2 + (i % 2);
      mesas.push({
        x: p[0], y: p[1], seed: i * 1.7,
        sillas: Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2 + i),
        colores: Array.from({ length: n }, (_, k) => cols[(i + k) % cols.length]),
      });
    });

    const camareros = [
      { puntos: [{ x: -0.5, y: 1 }, { x: -0.5, y: map.h - 1 }], i: 0, t: 0, vel: 0.14, seed: 0.4 },
      { puntos: [{ x: map.w + 0.5, y: map.h - 1 }, { x: map.w + 0.5, y: 1 }], i: 0, t: 0.5, vel: 0.11, seed: 2.1 },
      { puntos: [{ x: 1.5, y: map.h + 0.5 }, { x: map.w - 1.5, y: map.h + 0.5 }], i: 0, t: 0.2, vel: 0.08, seed: 3.7 },
    ];
    return { mesas, camareros };
  }

  global.Render = Render;
  global.TEAM_PALETTES = TEAM_PALETTES;
  global.chefColor = chefColor;
})(window);
