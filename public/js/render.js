/*
 * Renderizado 2.5D de la cocina Negi Sushi.
 *
 * Todo el arte del tablero se dibuja a mano con canvas (nada de emojis):
 * asi los ingredientes tienen estados visibles (entero / cortado / cocido),
 * los muebles tienen volumen y el conjunto se ve como un juego y no como
 * una cuadricula con pegatinas.
 */
(function (global) {
  'use strict';

  const LEGEND = {
    '#': 'wall', '-': 'edge', '.': 'floor', 'C': 'counter', 'B': 'board', 'K': 'cooker',
    'D': 'plates', 'W': 'sink', 'X': 'return', 'T': 'trash', 'V': 'serve',
    'N': 'crate', 'R': 'crate', 'P': 'crate', 'G': 'crate', 'S': 'crate',
  };
  const CRATE_ING = { N: 'nori', R: 'rice', P: 'cucumber', G: 'shrimp', S: 'salmon' };
  const SOLID = new Set(['wall', 'edge', 'counter', 'board', 'cooker', 'plates', 'sink', 'return', 'trash', 'serve', 'crate']);
  // solidas pero sin nada con lo que interactuar
  const MUDAS = new Set(['wall', 'edge']);

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
  // Alto que ocupan los tickets. No se reserva entero: la fila superior de la
  // cocina es borde invisible por su mitad izquierda, justo donde van los
  // pedidos, asi que pueden solaparla y solo hay que dejar libre lo que
  // sobresalga por encima de ella.
  const HUD_H = 64;
  const PAD = 6;
  const MARGEN_LADO = 0.03;   // fraccion del ancho que asoma del comedor

  const C = {
    tileA: '#efe4cb', tileB: '#e4d7b9', grout: 'rgba(120,102,72,.14)',
    woodTop: '#e7a95c', woodFace: '#a96e2b', woodEdge: '#f8d8a4', woodGrain: 'rgba(120,74,20,.18)',
    steelTop: '#c6cddc', steelFace: '#7e879b',
    darkTop: '#2c3040', darkFace: '#14161f',
    wallTop: '#3b4157', wallFace: '#1d2231',
  };

  const Render = {
    cv: null, ctx: null, dpr: 1, cw: 0, chh: 0,
    map: null, cells: null, ing: null, recipes: null,
    tw: 40, th: 30, bh: 20,
    cam: { x: 7, y: 4.5 },
    pops: [], overlays: [], t: 0,
    meId: null, myTeam: 'A',
    aim: { x: 0, y: 0, active: false, canThrow: false },
    throwRange: 7,
    scenery: null,

    // Imagenes opcionales que sustituyen al arte dibujado. Ver assets/LEEME.md
    assets: { listo: false, floor: null, wall: null, counter: null, chef: {}, ing: {} },

    /**
     * Carga public/assets/sprites.json si existe. Si no esta, o si una imagen
     * falla, se sigue usando el dibujo por defecto: el juego nunca se rompe
     * por un archivo de arte que falte.
     */
    loadAssets() {
      return fetch('assets/sprites.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (!cfg) return;
          const img = (src) => new Promise((res) => {
            if (!src) return res(null);
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => { console.warn('[assets] no se pudo cargar', src); res(null); };
            i.src = src;
          });
          const tareas = [];
          for (const k of ['floor', 'wall', 'counter']) {
            tareas.push(img(cfg[k]).then((i) => { this.assets[k] = i; }));
          }
          for (const d of ['abajo', 'lado', 'arriba']) {
            tareas.push(img(cfg.chef && cfg.chef[d]).then((i) => { this.assets.chef[d] = i; }));
          }
          for (const k in (cfg.ingredientes || {})) {
            tareas.push(img(cfg.ingredientes[k]).then((i) => { this.assets.ing[k] = i; }));
          }
          return Promise.all(tareas);
        })
        .catch(() => null)
        .then(() => { this.assets.listo = true; this.bgDirty = true; this.iconCache = {}; });
    },

    init(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.loadAssets();
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
      this.scenery = buildScenery(map);
      this.pops.length = 0;
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
    interactiveAt(x, y) {
      const c = this.cellAt(x, y);
      return !!c && SOLID.has(c.type) && !MUDAS.has(c.type);
    },

    /** Misma tolerancia que el servidor: la casilla interactiva mas alineada. */
    frontTile(ch) {
      const d = 0.34 + 0.5;
      const ex = Math.floor(ch.x + ch.fx * d), ey = Math.floor(ch.y + ch.fy * d);
      if (this.interactiveAt(ex, ey)) return { x: ex, y: ey };
      const cx = Math.floor(ch.x), cy = Math.floor(ch.y);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ dx, dy, dot: dx * ch.fx + dy * ch.fy }))
        .filter((o) => o.dot > 0.3)
        .sort((a, b) => b.dot - a.dot);
      for (const o of dirs) {
        if (this.interactiveAt(cx + o.dx, cy + o.dy)) return { x: cx + o.dx, y: cy + o.dy };
      }
      return null;
    },

    resize() {
      if (!this.cv) return;
      // Tope de 2x: a 2,5x en un movil son un 56% mas de pixeles que rellenar
      // cada fotograma, y a este tamano de dibujo no se aprecia la diferencia.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.cv.clientWidth || window.innerWidth;
      const h = this.cv.clientHeight || window.innerHeight;
      this.dpr = dpr; this.cw = w; this.chh = h;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      if (!this.map) return;
      // El hueco de arriba depende del alto de casilla, y el alto de casilla
      // depende del hueco: se resuelve en dos pasadas, que convergen de sobra.
      const lado = Math.max(PAD, w * MARGEN_LADO);
      const anchoMax = (w - lado * 2) / this.map.w;
      this.padTop = HUD_H;
      for (let i = 0; i < 2; i++) {
        const t = Math.min(anchoMax, (h - this.padTop - PAD) / (this.map.h * SQUASH));
        this.padTop = Math.max(PAD, HUD_H - t * SQUASH);
      }
      this.tw = Math.min(anchoMax, (h - this.padTop - PAD) / (this.map.h * SQUASH));
      this.th = this.tw * SQUASH;
      this.bh = this.tw * BLOCK;
      this.cam.x = this.map.w / 2;
      this.cam.y = this.map.h / 2;
      this.bgDirty = true;
      this.publishBounds();
    },

    /**
     * Publica el rectangulo que ocupa la cocina en pantalla como variables
     * CSS, para que el HUD se ancle al juego y no al borde del dispositivo.
     * En una tablet la cocina queda centrada y los pedidos se iban al techo.
     */
    publishBounds() {
      const r = document.documentElement.style;
      r.setProperty('--game-left', Math.round(this.sx(0)) + 'px');
      r.setProperty('--game-right', Math.round(this.cw - this.sx(this.map.w)) + 'px');
      r.setProperty('--game-top', Math.round(this.sy(0) - this.bh) + 'px');
      // Los tickets pueden bajar hasta la fila 1: la fila 0 solo tiene borde
      // invisible en su mitad izquierda, que es justo donde van.
      r.setProperty('--game-play-top', Math.round(this.sy(1) - this.bh) + 'px');
      // Ancho seguro: hasta la primera estacion de la fila superior, para que
      // los pedidos jamas tapen las cocinas por muchos que haya en cola.
      let corte = this.map.w;
      for (let x = 0; x < this.map.w; x++) {
        const c = this.cellAt(x, 0);
        if (c && SOLID.has(c.type) && !MUDAS.has(c.type)) { corte = x; break; }
      }
      r.setProperty('--hud-orders-max', Math.max(120, Math.round(this.sx(corte) - this.sx(0) - 10)) + 'px');
      r.setProperty('--game-bottom', Math.round(this.chh - this.sy(this.map.h)) + 'px');
    },

    /**
     * El comedor y el suelo se pintan UNA vez en un lienzo aparte y despues
     * solo se copian. Son cinco pasadas a pantalla completa (fondo, degradado
     * ambiente, baldosas, sombras de muebles y luz de cocina) que antes se
     * repetian 60 veces por segundo: ahi estaba el recalentamiento.
     *
     * Los muebles NO van aqui: hay que dibujarlos fila a fila intercalados
     * con los cocineros para que tapen a quien esta detras.
     */
    buildStatic() {
      const w = Math.round(this.cw * this.dpr), h = Math.round(this.chh * this.dpr);
      if (!this.bg) this.bg = document.createElement('canvas');
      if (this.bg.width !== w || this.bg.height !== h) { this.bg.width = w; this.bg.height = h; }
      const real = this.ctx;
      this.ctx = this.bg.getContext('2d');
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.cw, this.chh);
      this.drawScenery();
      this.drawFloor();
      this.ctx = real;
      this.bgDirty = false;
    },

    sx(x) { return (x - this.cam.x) * this.tw + this.cw / 2; },
    sy(y) { return (y - this.cam.y) * this.th + this.chh / 2 + (this.padTop || PAD) / 2; },
    follow() { /* camara fija centrada */ },

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
    ell(x, y, rx, ry, col) {
      const ctx = this.ctx;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill();
    },
    shadow(cx, cy, rx, alpha) {
      this.ell(cx, cy, rx, rx * 0.4, `rgba(24,16,6,${alpha})`);
    },
    glyph(txt, px, py, size) {
      const ctx = this.ctx;
      ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji",system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, px, py);
    },

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

    // ================================================================ COMIDA
    /**
     * Arte de cada ingrediente, dibujado segun su estado. Cortado = trozos,
     * cocido = brillo calido, quemado = carbon. Nada de iconos genericos.
     */
    drawFood(t, state, cx, cy, s) {
      const ctx = this.ctx;
      const propio = this.assets.ing[t + ':' + state] || this.assets.ing[t];
      if (propio) {
        ctx.drawImage(propio, cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
        return;
      }
      if (state === 'burnt') {
        this.ell(cx, cy, s * 0.34, s * 0.24, '#241b12');
        this.ell(cx - s * 0.1, cy - s * 0.08, s * 0.12, s * 0.08, '#3a2d1d');
        ctx.strokeStyle = '#4a3a26'; ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.beginPath(); ctx.moveTo(cx - s * 0.15, cy); ctx.lineTo(cx + s * 0.12, cy + s * 0.06); ctx.stroke();
        return;
      }
      switch (t) {
        case 'nori': {
          if (state === 'chopped') {
            for (let i = -1; i <= 1; i++) {
              ctx.fillStyle = '#245032';
              this.rr(cx + i * s * 0.24 - s * 0.09, cy - s * 0.22 + Math.abs(i) * s * 0.04, s * 0.18, s * 0.44, s * 0.03);
              ctx.fill();
              ctx.fillStyle = '#35714a';
              this.rr(cx + i * s * 0.24 - s * 0.06, cy - s * 0.18 + Math.abs(i) * s * 0.04, s * 0.12, s * 0.06, s * 0.02);
              ctx.fill();
            }
          } else {
            ctx.fillStyle = '#245032';
            this.rr(cx - s * 0.3, cy - s * 0.26, s * 0.6, s * 0.52, s * 0.05); ctx.fill();
            ctx.strokeStyle = '#35714a'; ctx.lineWidth = Math.max(1, s * 0.03);
            this.rr(cx - s * 0.24, cy - s * 0.2, s * 0.48, s * 0.4, s * 0.04); ctx.stroke();
            ctx.fillStyle = 'rgba(120,190,140,.35)';
            this.rr(cx - s * 0.22, cy - s * 0.18, s * 0.16, s * 0.1, s * 0.02); ctx.fill();
          }
          break;
        }
        case 'rice': {
          if (state === 'cooked') {
            // cuenco de arroz: se reconoce al instante, como el icono de antes
            this.ell(cx, cy - s * 0.02, s * 0.3, s * 0.22, '#fdfcf6');
            this.ell(cx - s * 0.09, cy - s * 0.1, s * 0.11, s * 0.07, '#ffffff');
            ctx.fillStyle = '#e9e6da';
            for (let i = 0; i < 5; i++) {
              const a = i * 1.257;
              this.ell(cx + Math.cos(a) * s * 0.14, cy - s * 0.02 + Math.sin(a) * s * 0.09, s * 0.035, s * 0.025, '#eeebe0');
            }
            ctx.fillStyle = '#dcd8cb';
            this.rr(cx - s * 0.3, cy + s * 0.04, s * 0.6, s * 0.06, s * 0.03); ctx.fill();
            ctx.fillStyle = '#e8f1f7';
            ctx.beginPath();
            ctx.moveTo(cx - s * 0.3, cy + s * 0.06);
            ctx.quadraticCurveTo(cx, cy + s * 0.34, cx + s * 0.3, cy + s * 0.06);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#2e6fa8';
            ctx.beginPath();
            ctx.moveTo(cx - s * 0.25, cy + s * 0.14);
            ctx.quadraticCurveTo(cx, cy + s * 0.28, cx + s * 0.25, cy + s * 0.14);
            ctx.quadraticCurveTo(cx, cy + s * 0.2, cx - s * 0.25, cy + s * 0.14);
            ctx.closePath(); ctx.fill();
          } else {
            // saco de arroz atado
            ctx.fillStyle = '#e6d6b2';
            this.rr(cx - s * 0.25, cy - s * 0.14, s * 0.5, s * 0.42, s * 0.1); ctx.fill();
            ctx.fillStyle = '#d3c197';
            this.rr(cx - s * 0.25, cy + s * 0.16, s * 0.5, s * 0.12, s * 0.05); ctx.fill();
            ctx.fillStyle = '#cdb787';
            ctx.beginPath();
            ctx.moveTo(cx - s * 0.14, cy - s * 0.12);
            ctx.lineTo(cx - s * 0.2, cy - s * 0.3);
            ctx.lineTo(cx + s * 0.2, cy - s * 0.3);
            ctx.lineTo(cx + s * 0.14, cy - s * 0.12);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#8d7444'; ctx.lineWidth = Math.max(1.5, s * 0.05);
            ctx.beginPath(); ctx.moveTo(cx - s * 0.17, cy - s * 0.19); ctx.lineTo(cx + s * 0.17, cy - s * 0.19); ctx.stroke();
            ctx.fillStyle = '#fdfcf6';
            for (let i = 0; i < 3; i++) this.ell(cx - s * 0.08 + i * s * 0.08, cy + s * 0.02, s * 0.03, s * 0.045, '#fdfcf6');
          }
          break;
        }
        case 'cucumber': {
          if (state === 'chopped') {
            const pos = [[-0.2, 0.05], [0.02, -0.1], [0.22, 0.06]];
            for (const [dx, dy] of pos) {
              this.ell(cx + dx * s, cy + dy * s, s * 0.14, s * 0.11, '#4c9b3c');
              this.ell(cx + dx * s, cy + dy * s, s * 0.1, s * 0.075, '#cdeaa2');
              this.ell(cx + dx * s - s * 0.03, cy + dy * s, s * 0.015, s * 0.02, '#f2f7d8');
              this.ell(cx + dx * s + s * 0.03, cy + dy * s, s * 0.015, s * 0.02, '#f2f7d8');
            }
          } else {
            ctx.save();
            ctx.translate(cx, cy); ctx.rotate(-0.35);
            ctx.fillStyle = '#4c9b3c';
            this.rr(-s * 0.3, -s * 0.11, s * 0.6, s * 0.22, s * 0.11); ctx.fill();
            ctx.fillStyle = '#3a7c2e';
            this.rr(-s * 0.22, -s * 0.08, s * 0.09, s * 0.16, s * 0.04); ctx.fill();
            this.rr(0, -s * 0.08, s * 0.09, s * 0.16, s * 0.04); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.25)';
            this.rr(-s * 0.24, -s * 0.08, s * 0.4, s * 0.05, s * 0.025); ctx.fill();
            ctx.restore();
          }
          break;
        }
        case 'shrimp': {
          if (state === 'chopped') {
            // colitas peladas
            for (let i = 0; i < 2; i++) {
              ctx.save();
              ctx.translate(cx + (i - 0.5) * s * 0.3, cy + (i ? -1 : 1) * s * 0.05);
              ctx.rotate(0.6 - i * 1.4);
              ctx.fillStyle = '#ff9166';
              ctx.beginPath();
              ctx.arc(0, 0, s * 0.15, Math.PI * 0.1, Math.PI * 1.35);
              ctx.arc(s * 0.04, 0, s * 0.08, Math.PI * 1.35, Math.PI * 0.1, true);
              ctx.closePath(); ctx.fill();
              ctx.strokeStyle = '#e5673f'; ctx.lineWidth = Math.max(1, s * 0.025);
              ctx.beginPath(); ctx.arc(0, 0, s * 0.12, Math.PI * 0.25, Math.PI * 1.15); ctx.stroke();
              ctx.restore();
            }
          } else {
            // Camaron entero: cuerpo curvo segmentado, cola en abanico,
            // patitas, antenas y ojo. Tiene que leerse como camaron en un
            // icono de 20 px del ticket.
            ctx.save();
            ctx.translate(cx, cy + s * 0.04);
            ctx.rotate(-0.2);
            // patas
            ctx.strokeStyle = '#e5673f'; ctx.lineWidth = Math.max(1, s * 0.025);
            for (let i = 0; i < 4; i++) {
              const a = Math.PI * (0.35 + i * 0.16);
              ctx.beginPath();
              ctx.moveTo(Math.cos(a) * s * 0.19, Math.sin(a) * s * 0.19);
              ctx.lineTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3);
              ctx.stroke();
            }
            // cuerpo en C
            ctx.fillStyle = '#ff8a5c';
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.23, Math.PI * 0.08, Math.PI * 1.42);
            ctx.arc(s * 0.02, 0, s * 0.11, Math.PI * 1.42, Math.PI * 0.08, true);
            ctx.closePath(); ctx.fill();
            // segmentos
            ctx.strokeStyle = '#e0603c'; ctx.lineWidth = Math.max(1, s * 0.028);
            for (let i = 0; i < 3; i++) {
              const a = Math.PI * (0.35 + i * 0.3);
              ctx.beginPath();
              ctx.moveTo(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.12);
              ctx.lineTo(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22);
              ctx.stroke();
            }
            // cola en abanico
            ctx.fillStyle = '#ff6f45';
            ctx.beginPath();
            ctx.moveTo(s * 0.02, -s * 0.2);
            ctx.lineTo(s * 0.24, -s * 0.34);
            ctx.lineTo(s * 0.2, -s * 0.14);
            ctx.lineTo(s * 0.3, -s * 0.06);
            ctx.lineTo(s * 0.06, -s * 0.09);
            ctx.closePath(); ctx.fill();
            // cabeza, ojo y antenas
            ctx.fillStyle = '#ff8a5c';
            this.ell(-s * 0.04, s * 0.2, s * 0.1, s * 0.09, '#ff8a5c');
            this.ell(-s * 0.07, s * 0.19, s * 0.028, s * 0.028, '#2a1a12');
            ctx.strokeStyle = '#e0603c'; ctx.lineWidth = Math.max(1, s * 0.022);
            ctx.beginPath();
            ctx.moveTo(-s * 0.1, s * 0.25); ctx.quadraticCurveTo(-s * 0.3, s * 0.3, -s * 0.34, s * 0.16);
            ctx.moveTo(-s * 0.1, s * 0.25); ctx.quadraticCurveTo(-s * 0.26, s * 0.4, -s * 0.12, s * 0.42);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'salmon': {
          if (state === 'chopped') {
            for (let i = 0; i < 2; i++) {
              ctx.save();
              ctx.translate(cx + (i - 0.5) * s * 0.3, cy + (i ? -1 : 1) * s * 0.04);
              ctx.rotate(-0.25 + i * 0.4);
              ctx.fillStyle = '#fc9273';
              this.rr(-s * 0.16, -s * 0.11, s * 0.32, s * 0.22, s * 0.05); ctx.fill();
              ctx.strokeStyle = '#ffe0d2'; ctx.lineWidth = Math.max(1, s * 0.03);
              ctx.beginPath();
              ctx.moveTo(-s * 0.1, -s * 0.08); ctx.quadraticCurveTo(0, 0, -s * 0.1, s * 0.08);
              ctx.moveTo(s * 0.02, -s * 0.08); ctx.quadraticCurveTo(s * 0.12, 0, s * 0.02, s * 0.08);
              ctx.stroke();
              ctx.restore();
            }
          } else {
            // Pescado entero: cuerpo, cola, aletas, branquia y ojo. Antes era
            // un filete rectangular y en el ticket no se leia como pescado.
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-0.1);
            // cola
            ctx.fillStyle = '#e8654a';
            ctx.beginPath();
            ctx.moveTo(-s * 0.18, 0);
            ctx.lineTo(-s * 0.42, -s * 0.18);
            ctx.lineTo(-s * 0.36, 0);
            ctx.lineTo(-s * 0.42, s * 0.18);
            ctx.closePath(); ctx.fill();
            // aleta dorsal y ventral
            ctx.beginPath();
            ctx.moveTo(-s * 0.04, -s * 0.14);
            ctx.lineTo(s * 0.02, -s * 0.29);
            ctx.lineTo(s * 0.12, -s * 0.12);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-s * 0.02, s * 0.14);
            ctx.lineTo(s * 0.04, s * 0.26);
            ctx.lineTo(s * 0.12, s * 0.12);
            ctx.closePath(); ctx.fill();
            // cuerpo
            this.ell(s * 0.02, 0, s * 0.3, s * 0.17, '#fc8161');
            // vientre mas claro
            ctx.save();
            ctx.beginPath(); ctx.ellipse(s * 0.02, 0, s * 0.3, s * 0.17, 0, 0, 7); ctx.clip();
            this.ell(s * 0.02, s * 0.11, s * 0.28, s * 0.09, '#ffd0bd');
            ctx.restore();
            // branquia
            ctx.strokeStyle = '#e0603c'; ctx.lineWidth = Math.max(1, s * 0.025);
            ctx.beginPath();
            ctx.arc(s * 0.16, 0, s * 0.11, -1.1, 1.1);
            ctx.stroke();
            // ojo
            this.ell(s * 0.22, -s * 0.04, s * 0.045, s * 0.045, '#fdf6ef');
            this.ell(s * 0.23, -s * 0.04, s * 0.026, s * 0.026, '#2a1a12');
            ctx.restore();
          }
          break;
        }
        default:
          this.ell(cx, cy, s * 0.24, s * 0.18, '#c8b088');
      }
    },

    drawPlate(cx, cy, s, dirty, contents) {
      const ctx = this.ctx;
      this.ell(cx, cy + s * 0.03, s * 0.5, s * 0.3, dirty ? '#8f8168' : '#dcd9d0');
      this.ell(cx, cy, s * 0.5, s * 0.3, dirty ? '#b3a68b' : '#f7f6f1');
      this.ell(cx, cy, s * 0.36, s * 0.2, dirty ? '#a3947a' : '#eceade');
      if (dirty) {
        this.ell(cx - s * 0.1, cy - s * 0.03, s * 0.09, s * 0.05, '#8f7f63');
        this.ell(cx + s * 0.12, cy + s * 0.04, s * 0.07, s * 0.04, '#8f7f63');
        return;
      }
      const list = contents || [];
      const n = list.length;
      list.forEach((t, i) => {
        const a = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = n === 1 ? 0 : s * 0.17;
        const st = this.ing && this.ing[t] && this.ing[t].prep === 'cook' ? 'cooked'
          : this.ing && this.ing[t] && this.ing[t].prep === 'chop' ? 'chopped' : 'raw';
        this.drawFood(t, st, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6 - s * 0.04, s * (n > 2 ? 0.5 : 0.62));
      });
    },

    drawItem(item, cx, cy, s, prog) {
      if (!item) return;
      if (item.k === 'p') { this.drawPlate(cx, cy, s, !!item.d, item.c); return; }
      const p = prog || 0;
      if (item.s === 'raw' && p > 0) {
        // a medio cortar: las dos mitades se separan y aparece la linea de corte
        const sep = s * 0.16 * p;
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx - s * 0.6, cy - s * 0.6, s * 0.6 - sep * 0.3, s * 1.2); ctx.clip();
        this.drawFood(item.t, 'raw', cx - sep, cy, s);
        ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.rect(cx + sep * 0.3, cy - s * 0.6, s * 0.6, s * 1.2); ctx.clip();
        this.drawFood(item.t, 'raw', cx + sep, cy, s);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.24); ctx.lineTo(cx, cy + s * 0.24); ctx.stroke();
        return;
      }
      this.drawFood(item.t, item.s, cx, cy, s);
    },

    drawPlateStack(cx, cy, size, n, dirty) {
      const k = Math.min(n, 4);
      for (let i = 0; i < k; i++) this.drawPlate(cx, cy - i * size * 0.11, size * 0.9, dirty, null);
      if (n > 4) {
        const ctx = this.ctx;
        ctx.fillStyle = '#20232e';
        ctx.font = `700 ${size * 0.3}px ui-sans-serif,system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('x' + n, cx, cy - k * size * 0.11 - size * 0.18);
      }
    },

    // ============================================================== ESCENARIO
    drawScenery() {
      const ctx = this.ctx;
      ctx.fillStyle = '#262032';
      ctx.fillRect(0, 0, this.cw, this.chh);
      // listones del suelo del local
      ctx.strokeStyle = 'rgba(255,255,255,.03)'; ctx.lineWidth = 1;
      for (let y = 0; y < this.chh; y += 26) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.cw, y); ctx.stroke();
      }
      const g = ctx.createRadialGradient(this.cw / 2, this.chh / 2, this.tw, this.cw / 2, this.chh / 2, this.cw * 0.75);
      g.addColorStop(0, 'rgba(255,196,130,.12)');
      g.addColorStop(1, 'rgba(0,0,0,.5)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cw, this.chh);

      const s = this.scenery;
      if (!s) return;
      for (const m of s.mesas) this.drawMesa(m);   // los camareros van en la capa animada
    },

    drawMesa(m) {
      const ctx = this.ctx;
      const cx = this.sx(m.x), cy = this.sy(m.y);
      if (cx < -140 || cx > this.cw + 140 || cy < -140 || cy > this.chh + 140) return;
      const r = this.tw * 0.5;
      this.shadow(cx, cy + r * 0.5, r * 1.1, 0.35);
      m.sillas.forEach((a, i) => {
        const px = cx + Math.cos(a) * r * 1.4, py = cy + Math.sin(a) * r * 1.05;
        this.drawComensal(px, py, m.colores[i], m.seed + i);
      });
      ctx.fillStyle = '#4a2a18';
      this.ell(cx, cy + 4, r, r * 0.72, '#4a2a18');
      this.ell(cx, cy, r, r * 0.72, '#7d4a2c');
      this.ell(cx, cy - 2, r * 0.82, r * 0.58, '#8d5836');
      // mantel individual + plato con sushi
      this.ell(cx, cy - 2, r * 0.5, r * 0.34, '#c9b9a0');
      this.drawPlate(cx, cy - 3, r * 0.55, false, ['salmon']);
    },

    drawComensal(px, py, col, seed) {
      const ctx = this.ctx;
      const r = this.tw * 0.2;
      const bob = Math.sin(seed) * r * 0.08;   // pose fija: va en la capa estatica
      this.shadow(px, py + r * 0.9, r * 0.75, 0.28);
      ctx.fillStyle = col;
      this.rr(px - r * 0.68, py - r * 0.2 + bob, r * 1.36, r * 1.15, r * 0.5); ctx.fill();
      this.ell(px, py - r * 0.72 + bob, r * 0.5, r * 0.5, '#f0c9a8');
      ctx.fillStyle = '#2b2119';
      ctx.beginPath(); ctx.arc(px, py - r * 1.0 + bob, r * 0.51, Math.PI, 0); ctx.fill();
    },

    drawCamarero(w) {
      const ctx = this.ctx;
      const p = w.puntos[w.i];
      const q = w.puntos[(w.i + 1) % w.puntos.length];
      const x = p.x + (q.x - p.x) * w.t;
      const y = p.y + (q.y - p.y) * w.t;
      const cx = this.sx(x), cy = this.sy(y);
      if (cx < -140 || cx > this.cw + 140 || cy < -140 || cy > this.chh + 140) return;
      const r = this.tw * 0.23;
      const paso = Math.sin(this.t * 8 + w.seed) * r * 0.15;
      this.shadow(cx, cy + r, r * 0.8, 0.32);
      ctx.fillStyle = '#20242e';
      this.rr(cx - r * 0.66, cy - r * 0.3 + paso * 0.3, r * 1.32, r * 1.3, r * 0.45); ctx.fill();
      ctx.fillStyle = '#f4f1e8';
      this.rr(cx - r * 0.2, cy - r * 0.3 + paso * 0.3, r * 0.4, r * 0.95, r * 0.16); ctx.fill();
      this.ell(cx, cy - r * 0.82 + paso * 0.3, r * 0.48, r * 0.48, '#e8b990');
      ctx.fillStyle = '#241a12';
      ctx.beginPath(); ctx.arc(cx, cy - r * 1.05 + paso * 0.3, r * 0.49, Math.PI, 0); ctx.fill();
      this.ell(cx + r * 0.85, cy - r * 0.5 - paso, r * 0.42, r * 0.16, '#cfd6e2');
      this.drawPlate(cx + r * 0.85, cy - r * 0.62 - paso, r * 0.5, false, null);
    },

    stepScenery(dt) {
      const s = this.scenery;
      if (!s) return;
      for (const w of s.camareros) {
        w.t += dt * w.vel;
        while (w.t >= 1) { w.t -= 1; w.i = (w.i + 1) % w.puntos.length; }
      }
    },

    // ================================================================ COCINA
    drawFloor() {
      const ctx = this.ctx;
      for (let y = 0; y < this.map.h; y++) {
        for (let x = 0; x < this.map.w; x++) {
          const c = this.cellAt(x, y);
          if (!c || MUDAS.has(c.type)) continue;
          const px = this.sx(x), py = this.sy(y);
          if (this.assets.floor) {
            ctx.drawImage(this.assets.floor, px, py, this.tw + 0.6, this.th + 0.6);
          } else {
            ctx.fillStyle = (x + y) % 2 ? C.tileA : C.tileB;
            ctx.fillRect(px, py, this.tw + 0.6, this.th + 0.6);
            ctx.strokeStyle = C.grout; ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, this.tw, this.th);
          }
        }
      }
      // sombra que proyectan los muebles sobre el suelo de debajo
      ctx.fillStyle = 'rgba(40,26,10,.16)';
      for (let y = 0; y < this.map.h - 1; y++) {
        for (let x = 0; x < this.map.w; x++) {
          const c = this.cellAt(x, y);
          const abajo = this.cellAt(x, y + 1);
          if (c && SOLID.has(c.type) && abajo && !SOLID.has(abajo.type)) {
            ctx.fillRect(this.sx(x), this.sy(y + 1), this.tw + 0.5, this.th * 0.34);
          }
        }
      }
      const d = (this.map.deco || []).find((r) => r.type === 'rug');
      if (d) {
        ctx.fillStyle = '#7a2036';
        this.rr(this.sx(d.x), this.sy(d.y), d.w * this.tw, d.h * this.th, 6); ctx.fill();
        ctx.strokeStyle = '#c8a24a'; ctx.lineWidth = 2;
        this.rr(this.sx(d.x) + 4, this.sy(d.y) + 4, d.w * this.tw - 8, d.h * this.th - 8, 4); ctx.stroke();
      }

      // luz calida en el centro de la cocina, bordes ligeramente en sombra
      const kx = this.sx(this.map.w / 2), ky = this.sy(this.map.h / 2);
      const g = ctx.createRadialGradient(kx, ky, this.tw * 2, kx, ky, this.tw * this.map.w * 0.62);
      g.addColorStop(0, 'rgba(255,214,150,.07)');
      g.addColorStop(0.75, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(30,18,6,.14)');
      ctx.fillStyle = g;
      ctx.fillRect(this.sx(0), this.sy(0), this.map.w * this.tw, this.map.h * this.th);
    },

    drawRowBlocks(y) {
      for (let x = 0; x < this.map.w; x++) {
        const c = this.cellAt(x, y);
        if (!c || !SOLID.has(c.type)) continue;
        this.drawBlock(c);
      }
    },

    drawBlock(c) {
      const ctx = this.ctx, s = this.tw;
      let b;
      if (c.type === 'edge') return;   // borde invisible: frena pero no se pinta
      // Sustitucion por imagen propia, si la hay para este tipo de mueble
      const img = c.type === 'wall' ? this.assets.wall
                : c.type === 'counter' ? this.assets.counter : null;
      if (img) {
        const px = this.sx(c.x), py = this.sy(c.y) - this.bh;
        ctx.drawImage(img, px, py, this.tw, this.th + this.bh);
        return;
      }
      switch (c.type) {
        case 'wall': {
          // Las paredes laterales van en azul, como en el plano de referencia
          const lateral = c.x === 0 || c.x === this.map.w - 1;
          b = this.block(c.x, c.y,
                         lateral ? '#0f4b6b' : C.wallFace,
                         lateral ? '#1d6f97' : C.wallTop, 3);
          // azulejos del muro: junta horizontal y vertical alternada
          ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b.px, b.py + b.h * 0.52); ctx.lineTo(b.px + b.w, b.py + b.h * 0.52);
          ctx.moveTo(b.px + b.w * ((c.x + c.y) % 2 ? 0.3 : 0.68), b.py);
          ctx.lineTo(b.px + b.w * ((c.x + c.y) % 2 ? 0.3 : 0.68), b.py + b.h * 0.52);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.06)';
          ctx.fillRect(b.px + 2, b.py + 2, b.w - 4, 2);
          break;
        }

        case 'counter':
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          ctx.strokeStyle = C.woodEdge; ctx.lineWidth = 2;
          this.rr(b.px + 3, b.py + 3, b.w - 6, b.h - 6, 4); ctx.stroke();
          ctx.strokeStyle = C.woodGrain; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b.px + 6, b.py + b.h * 0.4); ctx.lineTo(b.px + b.w - 6, b.py + b.h * 0.4);
          ctx.moveTo(b.px + 6, b.py + b.h * 0.66); ctx.lineTo(b.px + b.w - 6, b.py + b.h * 0.66);
          ctx.stroke();
          break;

        case 'board': {
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          ctx.fillStyle = '#d9a874';
          this.rr(b.px + s * 0.09, b.py + s * 0.06, s * 0.82, b.h - s * 0.1, 5); ctx.fill();
          ctx.fillStyle = 'rgba(120,74,20,.25)';
          this.rr(b.px + s * 0.09, b.py + b.h - s * 0.1, s * 0.82, s * 0.05, 2); ctx.fill();
          ctx.strokeStyle = '#b98450'; ctx.lineWidth = 1;
          for (let i = 1; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(b.px + s * 0.16, b.py + s * 0.06 + i * (b.h - s * 0.14) / 3);
            ctx.lineTo(b.px + s * 0.84, b.py + s * 0.06 + i * (b.h - s * 0.14) / 3);
            ctx.stroke();
          }
          break;
        }

        case 'crate': {
          b = this.block(c.x, c.y, '#7c4f1e', '#b5813a', 5);
          // interior abierto con el ingrediente a la vista
          ctx.fillStyle = '#5d3a14';
          this.rr(b.px + 4, b.py + 4, b.w - 8, b.h - 8, 4); ctx.fill();
          this.drawFood(c.ing, 'raw', b.px + b.w / 2, b.py + b.h / 2, s * 0.68);
          ctx.strokeStyle = 'rgba(255,220,160,.4)'; ctx.lineWidth = 2;
          this.rr(b.px + 2.5, b.py + 2.5, b.w - 5, b.h - 5, 4); ctx.stroke();
          break;
        }

        case 'cooker': {
          b = this.block(c.x, c.y, C.steelFace, C.steelTop, 5);
          // olla: cuerpo + borde metalico (el contenido lo pinta drawTileRow)
          this.ell(b.px + b.w / 2, b.py + b.h / 2 + 2, s * 0.33, s * 0.24, '#2c3140');
          this.ell(b.px + b.w / 2, b.py + b.h / 2, s * 0.33, s * 0.24, '#454c60');
          this.ell(b.px + b.w / 2, b.py + b.h / 2, s * 0.27, s * 0.19, '#22262f');
          ctx.strokeStyle = '#dfe5f2'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.33, s * 0.24, 0, 0, 7); ctx.stroke();
          break;
        }

        case 'plates':
          b = this.block(c.x, c.y, C.woodFace, C.woodTop, 5);
          break;

        case 'sink': {
          b = this.block(c.x, c.y, '#5b6274', '#848da2', 5);
          ctx.fillStyle = '#25404f';
          this.rr(b.px + 4, b.py + 4, b.w - 8, b.h - 8, 5); ctx.fill();
          ctx.fillStyle = '#5fc0e4';
          this.rr(b.px + 6, b.py + 6, b.w - 12, b.h - 12, 4); ctx.fill();
          break;
        }

        case 'return':
          b = this.block(c.x, c.y, C.woodFace, '#b58c56', 5);
          ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.26, s * 0.18, 0, 0, 7); ctx.stroke();
          ctx.setLineDash([]);
          break;

        case 'trash':
          b = this.block(c.x, c.y, '#101219', '#232836', 5);
          this.ell(b.px + b.w / 2, b.py + b.h / 2 + 2, s * 0.3, s * 0.22, '#05060a');
          this.ell(b.px + b.w / 2, b.py + b.h / 2, s * 0.3, s * 0.22, '#0d0f16');
          ctx.strokeStyle = '#4a5162'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(b.px + b.w / 2, b.py + b.h / 2, s * 0.32, s * 0.24, 0, 0, 7); ctx.stroke();
          break;

        case 'serve': {
          b = this.block(c.x, c.y, '#0b0d14', C.darkTop, 4);
          ctx.fillStyle = '#171a26';
          this.rr(b.px + 4, b.py + 4, b.w - 8, b.h - 8, 4); ctx.fill();
          ctx.fillStyle = 'rgba(255,209,102,.9)';
          this.rr(b.px + 2, b.py + b.h - 4, b.w - 4, 3, 1.5); ctx.fill();
          break;
        }

        default: break;
      }
    },

    /** Lo poco que se mueve de los muebles, encima de la capa cacheada. */
    drawBlockAnim() {
      const ctx = this.ctx, s = this.tw;
      for (const c of this.cells) {
        if (c.type === 'serve') {
          const px = this.sx(c.x), py = this.sy(c.y) - this.bh;
          ctx.save();
          this.rr(px + 4, py + 4, this.tw - 8, this.th - 8, 4);
          ctx.clip();
          ctx.strokeStyle = 'rgba(255,209,102,.75)'; ctx.lineWidth = 3;
          const off = (this.t * 26) % 14;
          for (let yy = -14; yy < this.th + 14; yy += 14) {
            ctx.beginPath();
            ctx.moveTo(px + 6, py + yy + off);
            ctx.lineTo(px + this.tw / 2, py + yy + off + 6);
            ctx.lineTo(px + this.tw - 6, py + yy + off);
            ctx.stroke();
          }
          ctx.restore();
        } else if (c.type === 'sink') {
          const px = this.sx(c.x), py = this.sy(c.y) - this.bh;
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
          const ph = (this.t * 0.6) % 1;
          ctx.beginPath();
          ctx.arc(px + this.tw * (0.3 + ph * 0.3), py + this.th * 0.5, s * 0.08, 0.3, 2.4);
          ctx.stroke();
        }
      }
    },

    drawSign() {
      const d = (this.map.deco || []).find((x) => x.type === 'sign');
      if (!d) return;
      const ctx = this.ctx;
      const x = this.sx(d.x), y = this.sy(d.y) - this.bh * 1.15;
      const w = d.w * this.tw, h = d.h * this.th * 1.1;
      ctx.fillStyle = '#0a1420';
      this.rr(x, y, w, h, 6); ctx.fill();
      ctx.save();
      ctx.strokeStyle = '#3ad9ff'; ctx.lineWidth = 2;
      ctx.shadowColor = '#3ad9ff'; ctx.shadowBlur = 14;
      this.rr(x + 2, y + 2, w - 4, h - 4, 5); ctx.stroke();
      ctx.fillStyle = '#c4f3ff';
      ctx.font = `700 ${Math.max(9, h * 0.48)}px ui-monospace,Consolas,monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.text, x + w / 2, y + h / 2);
      ctx.restore();
    },

    // ================================================================= FRAME
    draw(view, dt) {
      const ctx = this.ctx;
      this.t += dt;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.chh);
      if (!this.map) { ctx.fillStyle = '#101119'; ctx.fillRect(0, 0, this.cw, this.chh); return; }

      if (this.bgDirty || !this.bg) this.buildStatic();
      ctx.drawImage(this.bg, 0, 0, this.cw, this.chh);

      this.stepScenery(dt);
      for (const w of this.scenery.camareros) this.drawCamarero(w);

      const chefs = (view && view.chefs) || [];
      const tiles = (view && view.tiles) || {};
      this.overlays.length = 0;

      if (view) { this.drawGround(view.gnd); this.drawAim(view); }

      for (let y = 0; y < this.map.h; y++) {
        this.drawRowBlocks(y);
        this.drawTileRow(y, tiles);
        for (const ch of chefs) if (Math.floor(ch.y) === y) this.drawChef(ch);
      }
      this.drawBlockAnim();
      this.drawSign();
      // El resaltado va DESPUES de los muebles: dibujado antes quedaba tapado
      // por la propia encimera que estaba senalando y no se veia nunca.
      if (view) this.drawTarget(view, tiles);

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

        const barAt = (p, col) => this.overlays.push({ kind: 'bar', x: px + s * 0.12, y: py - 9, w: s * 0.76, h: 6, p, col });
        const iconAt = (text, col) => this.overlays.push({ kind: 'icon', text, col, x: cx, y: py - 12, size: s * 0.42 });

        if (c.type === 'counter' || c.type === 'board') {
          if (st.i) this.drawItem(st.i, cx, cy - s * 0.04, s * 0.78, st.p);
          if (st.p > 0) barAt(st.p, '#ffd166');
        } else if (c.type === 'cooker') {
          const pot = st.pot;
          if (pot.s === 'cooking') {
            this.ell(cx, cy, s * 0.24, s * 0.17, '#efe9d8');
            barAt(pot.p, '#ff9f43');
            ctx.fillStyle = 'rgba(255,255,255,.3)';
            for (let k = 0; k < 3; k++) {
              const ph = (this.t * 0.8 + k * 0.33) % 1;
              this.ell(cx + Math.sin((this.t + k) * 2) * s * 0.09, cy - ph * s * 0.75, s * 0.07 * (1 - ph * 0.5), s * 0.07 * (1 - ph * 0.5), `rgba(255,255,255,${0.35 * (1 - ph)})`);
            }
          } else if (pot.s === 'cooked') {
            this.drawFood('rice', 'cooked', cx, cy, s * 0.62);
            barAt(pot.p, '#ff5f5a');
            if (Math.sin(this.t * 8) > 0) iconAt('✔', '#49d78a');
          } else if (pot.s === 'burnt') {
            this.drawFood('rice', 'burnt', cx, cy, s * 0.62);
            iconAt('🔥', '#ff5f5a');
          }
        } else if (c.type === 'sink') {
          if (st.d) this.drawPlateStack(cx - s * 0.15, cy, s * 0.46, st.d, true);
          if (st.c) this.drawPlateStack(cx + s * 0.17, cy, s * 0.46, st.c, false);
          if (st.p > 0) barAt(st.p, '#5fc0e4');
        } else if (c.type === 'return') {
          if (st.d) this.drawPlateStack(cx, cy, s * 0.56, st.d, true);
        } else if (c.type === 'plates') {
          if (st.n > 0) this.drawPlateStack(cx, cy, s * 0.62, st.n, false);
        }
      }
    },

    drawGround(list) {
      if (!list || !list.length) return;
      const s = this.tw;
      for (const g of list) {
        const px = this.sx(g.x), py = this.sy(g.y);
        this.shadow(px, py + s * 0.08, s * 0.2, 0.28);
        this.drawItem(g.i, px, py - s * 0.04, s * 0.56, 0);
      }
    },

    drawFlying(list) {
      if (!list || !list.length) return;
      const ctx = this.ctx, s = this.tw;
      for (const f of list) {
        const px = this.sx(f.x), py = this.sy(f.y);
        const h = Math.sin(Math.min(1, f.p) * Math.PI) * s * 0.9;
        this.shadow(px, py + s * 0.06, s * 0.16, 0.3);
        ctx.save();
        ctx.translate(px, py - h);
        ctx.rotate(this.t * 8);
        this.drawItem(f.i, 0, 0, s * 0.7, 0);
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
      ctx.beginPath(); ctx.ellipse(this.sx(px), this.sy(py), this.tw * 0.22, this.th * 0.22, 0, 0, 7); ctx.stroke();
      ctx.restore();
    },

    /** Resalta la casilla activa: verde si el boton hara algo, blanco si no. */
    drawTarget(view, tiles) {
      const me = (view.chefs || []).find((c) => c.id === this.meId);
      if (!me || !this.map) return;
      const f = this.frontTile(me);
      if (!f) return;
      const c = this.cellAt(f.x, f.y);
      const st = tiles[f.y * this.map.w + f.x];
      const h = me.h;
      let util = false;
      switch (c.type) {
        case 'crate': util = !h; break;
        case 'board': util = h ? true : !!(st && st.i); break;
        case 'counter': util = h ? true : !!(st && st.i); break;
        case 'cooker':
          util = h ? (h.k === 'i' && h.t === 'rice' && h.s === 'raw' && !st)
                   : !!(st && st.pot && st.pot.s !== 'cooking'); break;
        case 'plates': util = !h && (!st || st.n > 0); break;
        case 'sink': util = h ? (h.k === 'p' && !!h.d) : !!(st && (st.c > 0 || st.d > 0)); break;
        case 'return': util = h ? (h.k === 'p' && !!h.d) : !!(st && st.d > 0); break;
        case 'trash': util = !!h; break;
        case 'serve': util = !!(h && h.k === 'p' && !h.d && h.c.length); break;
        default: util = false;
      }
      // Seleccion bien marcada: halo, contorno grueso, relleno y una flecha
      // encima. Tiene que verse a un metro de distancia en un movil.
      const ctx = this.ctx;
      const x = this.sx(f.x), y = this.sy(f.y) - this.bh;
      const col = util ? '#6dffa6' : '#ffffff';
      const pulso = 0.5 + Math.sin(this.t * 6) * 0.5;
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 10 + pulso * 12;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = 0.85;
      this.rr(x + 2, y + 2, this.tw - 4, this.th - 4, 7);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = util ? 0.2 + pulso * 0.12 : 0.1;
      ctx.fillStyle = col;
      this.rr(x + 2, y + 2, this.tw - 4, this.th - 4, 7);
      ctx.fill();
      // flecha flotante sobre la estacion apuntada
      ctx.globalAlpha = 0.95;
      const ay = y - this.tw * 0.2 - pulso * this.tw * 0.06;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x + this.tw / 2, ay + this.tw * 0.16);
      ctx.lineTo(x + this.tw / 2 - this.tw * 0.13, ay);
      ctx.lineTo(x + this.tw / 2 + this.tw * 0.13, ay);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    // ================================================================ CHEF
    drawChef(ch) {
      const ctx = this.ctx;
      const s = this.tw;
      const px = this.sx(ch.x), py = this.sy(ch.y);
      const col = chefColor(this.myTeam, ch.s);
      const r = s * 0.36;
      const mirando = ch.fy < -0.35 ? 'arriba' : ch.fy > 0.35 ? 'abajo' : 'lado';
      const flip = ch.fx < 0 ? -1 : 1;
      const andando = (ch.v || 0) > 0.4;
      const paso = andando ? Math.sin(this.t * 13) : 0;
      const bob = Math.abs(paso) * r * 0.12;

      this.shadow(px, py + r * 0.32, r * 0.92, 0.34);

      if (ch.d) {
        ctx.strokeStyle = 'rgba(255,255,255,.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px - ch.fx * r * 1.2, py - ch.fy * r * 0.7 - r, r * 0.85, 0, 7);
        ctx.stroke();
      }

      const baseY = py - r * 0.5 - bob;

      // Avatar propio: se dibuja la imagen y encima solo el objeto en mano y
      // el nombre. La franja de color del equipo se pinta bajo los pies para
      // que se siga sabiendo de quien es cada cocinero.
      const sprite = this.assets.chef[mirando];
      if (sprite) {
        const alto = r * 3.1, ancho = alto * (sprite.width / sprite.height);
        ctx.save();
        if (mirando === 'lado' && flip < 0) {
          ctx.translate(px, 0); ctx.scale(-1, 1); ctx.translate(-px, 0);
        }
        ctx.drawImage(sprite, px - ancho / 2, py - alto + r * 0.28, ancho, alto);
        ctx.restore();
        this.ell(px, py + r * 0.3, r * 0.5, r * 0.16, col);
        this.drawChefExtras(ch, px, py, r, s, col, flip);
        return;
      }

      // piernas + zapatos
      ctx.fillStyle = '#2b3040';
      ctx.fillRect(px - r * 0.4, baseY + r * 0.4, r * 0.32, r * 0.52 + paso * r * 0.15);
      ctx.fillRect(px + r * 0.08, baseY + r * 0.4, r * 0.32, r * 0.52 - paso * r * 0.15);
      ctx.fillStyle = '#15171f';
      this.rr(px - r * 0.46, baseY + r * 0.88 + paso * r * 0.15, r * 0.44, r * 0.18, r * 0.08); ctx.fill();
      this.rr(px + r * 0.02, baseY + r * 0.88 - paso * r * 0.15, r * 0.44, r * 0.18, r * 0.08); ctx.fill();

      // cuerpo: chaquetilla + delantal del equipo
      ctx.fillStyle = '#f8f6ef';
      this.rr(px - r * 0.74, baseY - r * 0.52, r * 1.48, r * 1.06, r * 0.36); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.07)';
      this.rr(px - r * 0.74, baseY + r * 0.3, r * 1.48, r * 0.24, r * 0.12); ctx.fill();
      ctx.fillStyle = col;
      this.rr(px - r * 0.44, baseY - r * 0.14, r * 0.88, r * 0.68, r * 0.16); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      this.ell(px - r * 0.18, baseY - r * 0.02, r * 0.045, r * 0.045, 'rgba(255,255,255,.6)');
      this.ell(px + r * 0.18, baseY - r * 0.02, r * 0.045, r * 0.045, 'rgba(255,255,255,.6)');

      // brazos
      const braz = ch.h ? 0 : paso * r * 0.2;
      ctx.fillStyle = '#f2efe6';
      if (ch.h) {
        // brazos hacia delante sujetando el objeto
        this.ell(px - r * 0.55, baseY + r * 0.06, r * 0.19, r * 0.26, '#f2efe6');
        this.ell(px + r * 0.55, baseY + r * 0.06, r * 0.19, r * 0.26, '#f2efe6');
      } else {
        this.ell(px - r * 0.8, baseY - r * 0.04 + braz, r * 0.19, r * 0.28, '#f2efe6');
        this.ell(px + r * 0.8, baseY - r * 0.04 - braz, r * 0.19, r * 0.28, '#f2efe6');
      }

      // cabeza
      const hy = baseY - r * 0.94;
      this.ell(px, hy, r * 0.52, r * 0.52, '#f0c9a3');
      // gorro
      ctx.fillStyle = '#ffffff';
      this.ell(px, hy - r * 0.6, r * 0.6, r * 0.4, '#ffffff');
      this.ell(px - r * 0.3, hy - r * 0.5, r * 0.28, r * 0.26, '#ffffff');
      this.ell(px + r * 0.3, hy - r * 0.5, r * 0.28, r * 0.26, '#ffffff');
      ctx.fillStyle = '#eceae2';
      this.rr(px - r * 0.55, hy - r * 0.38, r * 1.1, r * 0.28, r * 0.1); ctx.fill();
      ctx.fillStyle = col;
      this.rr(px - r * 0.55, hy - r * 0.16, r * 1.1, r * 0.12, r * 0.06); ctx.fill();

      // cara
      if (mirando !== 'arriba') {
        const ex = mirando === 'lado' ? r * 0.15 * flip : 0;
        this.ell(px - r * 0.18 + ex, hy + r * 0.04, r * 0.07, r * 0.1, '#2a2019');
        this.ell(px + r * 0.18 + ex, hy + r * 0.04, r * 0.07, r * 0.1, '#2a2019');
        this.ell(px - r * 0.3 + ex, hy + r * 0.16, r * 0.08, r * 0.05, 'rgba(240,130,110,.4)');
        this.ell(px + r * 0.3 + ex, hy + r * 0.16, r * 0.08, r * 0.05, 'rgba(240,130,110,.4)');
        ctx.strokeStyle = '#b9846a'; ctx.lineWidth = Math.max(1, r * 0.06); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(px + ex * 0.6, hy + r * 0.2, r * 0.13, 0.3, Math.PI - 0.3); ctx.stroke();
      }

      this.drawChefExtras(ch, px, py, r, s, col, flip);
    },

    /** Objeto en mano, cuchillo, nombre y flecha: comun al avatar dibujado
     *  y a los sprites que ponga el jugador. */
    drawChefExtras(ch, px, py, r, s, col, flip) {
      const ctx = this.ctx;

      // objeto en las manos: con fondo blanco para que se vea SIEMPRE
      if (ch.h) {
        const iy = py - r * 0.48 + Math.sin(this.t * 3) * r * 0.04;
        this.ell(px, iy, r * 0.52, r * 0.42, 'rgba(255,255,255,.94)');
        ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(px, iy, r * 0.52, r * 0.42, 0, 0, 7); ctx.stroke();
        this.drawItem(ch.h, px, iy, s * 0.6, 0);
      }

      // cuchillo cuando corta
      if (ch.c) {
        const osc = Math.sin(this.t * 26) * 0.7;
        ctx.save();
        ctx.translate(px + r * 0.8 * flip, py - r * 0.9);
        ctx.rotate((-0.9 + osc) * flip);
        ctx.fillStyle = '#e7ebf5';
        this.rr(-r * 0.07, -r * 0.62, r * 0.14, r * 0.62, r * 0.05); ctx.fill();
        ctx.fillStyle = '#5a3b23';
        this.rr(-r * 0.09, 0, r * 0.18, r * 0.26, r * 0.05); ctx.fill();
        ctx.restore();
      }

      // nombre
      const label = ch.b ? '\u{1F916} ' + ch.n : ch.n;
      ctx.font = `700 ${Math.max(9, s * 0.22)}px ui-sans-serif,system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.strokeText(label, px, py + r * 0.92);
      ctx.fillStyle = ch.id === this.meId ? '#ffd166' : ch.b ? '#c3c9d8' : '#f2f0e8';
      ctx.fillText(label, px, py + r * 0.92);

      if (ch.id === this.meId) {
        ctx.fillStyle = 'rgba(255,209,102,.95)';
        const ay = py - r * 2.9 + Math.sin(this.t * 4) * r * 0.12;
        ctx.beginPath();
        ctx.moveTo(px, ay + r * 0.32); ctx.lineTo(px - r * 0.24, ay); ctx.lineTo(px + r * 0.24, ay);
        ctx.closePath(); ctx.fill();
      }
    },

    bar(x, y, w, h, p, col) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(10,8,4,.65)';
      this.rr(x - 1, y - 1, w + 2, h + 2, (h + 2) / 2); ctx.fill();
      ctx.fillStyle = col;
      this.rr(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, p)), h - 2, (h - 2) / 2); ctx.fill();
    },

    addEvents(evts) {
      const texts = {
        serve: null, bad: null, trash: '🗑', chop: '✓', wash: '✨',
        ready: '🔔', burn: '🔥', add: '+', hint: '?', expire: null,
        throw: '💨', catch: '👏', land: '⬇', tap: null,
      };
      (evts || []).forEach((e) => {
        if (e.e === 'expire') return;
        if (e.e === 'tap') {
          this.pops.push({ x: e.x + (Math.random() - 0.5) * 0.3, y: e.y, life: 0.5, text: '✦', col: '#ffe6a0', small: true });
          return;
        }
        this.pops.push({
          x: e.x, y: e.y, life: 1,
          text: e.s || texts[e.e] || '',
          col: e.e === 'serve' || e.e === 'catch' || e.e === 'chop' ? '#49d78a' : e.e === 'bad' ? '#ff6b6b' : '#ffffff',
        });
      });
    },

    drawPops(dt) {
      const ctx = this.ctx, s = this.tw;
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const p = this.pops[i];
        p.life -= dt * (p.small ? 2.2 : 1.1);
        if (p.life <= 0) { this.pops.splice(i, 1); continue; }
        const a = Math.min(1, p.life * 1.6);
        const px = this.sx(p.x), py = this.sy(p.y) - this.bh - (1 - p.life) * s * 0.7;
        ctx.globalAlpha = a;
        ctx.font = `800 ${Math.max(10, s * (p.small ? 0.34 : 0.4))}px ui-sans-serif,system-ui`;
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
   * Iconos para el HUD dibujados con el MISMO arte que el tablero, cacheados
   * como data URL. Antes los tickets usaban emojis y el cajon otra cosa: por
   * eso parecia que pedian un pescado que no estaba en la cocina.
   */
  Render.iconCache = {};
  Render.iconFor = function (type, state, px) {
    const key = type + ':' + state + ':' + px;
    if (this.iconCache[key]) return this.iconCache[key];
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const real = this.ctx;
    this.ctx = cv.getContext('2d');
    this.drawFood(type, state, px / 2, px / 2, px * 0.92);
    this.ctx = real;
    return (this.iconCache[key] = cv.toDataURL('image/png'));
  };

  /** El plato terminado tal y como debe verse al servirlo. */
  Render.dishIcon = function (items, px) {
    const key = 'dish:' + items.join('+') + ':' + px;
    if (this.iconCache[key]) return this.iconCache[key];
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const real = this.ctx;
    this.ctx = cv.getContext('2d');
    this.drawPlate(px / 2, px / 2, px * 0.95, false, items);
    this.ctx = real;
    return (this.iconCache[key] = cv.toDataURL('image/png'));
  };

  function buildScenery(map) {
    const mesas = [];
    const cols = ['#c8564b', '#4b7ec8', '#48a06a', '#c8a24a', '#8a5fc0', '#d0793f'];
    // Solo a los lados: arriba van los pedidos y abajo los controles, y ahi
    // el comedor solo estorbaria.
    const puestos = [
      [-0.8, 1.2], [-0.8, 3.6], [-0.8, 6.0], [-0.8, 8.2],
      [map.w + 0.8, 1.0], [map.w + 0.8, 3.4], [map.w + 0.8, 5.8], [map.w + 0.8, 8.0],
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
      { puntos: [{ x: -0.45, y: 0.5 }, { x: -0.45, y: map.h - 0.5 }], i: 0, t: 0, vel: 0.14, seed: 0.4 },
      { puntos: [{ x: map.w + 0.45, y: map.h - 0.5 }, { x: map.w + 0.45, y: 0.5 }], i: 0, t: 0.5, vel: 0.11, seed: 2.1 },
    ];
    return { mesas, camareros };
  }

  global.Render = Render;
  global.TEAM_PALETTES = TEAM_PALETTES;
  global.chefColor = chefColor;
})(window);
