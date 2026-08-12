/* Renderizador 2D del mapa Negi Sushi (vista cenital con relieve tipo Overcooked). */
(function (global) {
  'use strict';

  const LEGEND = {
    '#': 'wall', '.': 'floor', 'C': 'counter', 'B': 'board', 'K': 'cooker',
    'D': 'plates', 'W': 'sink', 'X': 'return', 'T': 'trash', 'V': 'serve',
    'N': 'crate', 'R': 'crate', 'P': 'crate', 'G': 'crate', 'S': 'crate',
  };
  const CRATE_ING = { N: 'nori', R: 'rice', P: 'cucumber', G: 'shrimp', S: 'salmon' };
  const SOLID = new Set(['wall', 'counter', 'board', 'cooker', 'plates', 'sink', 'return', 'trash', 'serve', 'crate']);
  // Una paleta por equipo: asi el color del punto en el lobby es el mismo
  // que el del delantal del cocinero dentro de la partida.
  const TEAM_PALETTES = {
    A: ['#ff5757', '#ff9f43', '#ffd166'],
    B: ['#4aa8ff', '#7c5cff', '#00d5c0'],
  };
  const chefColor = (team, slot) => {
    const p = TEAM_PALETTES[team] || TEAM_PALETTES.A;
    return p[slot % p.length];
  };

  const C = {
    floorA: '#dcd5c6', floorB: '#d0c8b7', grout: '#bdb4a2',
    wall: '#2b3040', wallTop: '#3b4257',
    wood: '#e0a75f', woodSide: '#a9773a', woodTop: '#eab873',
    metal: '#8f97ad', metalTop: '#b6bdd0',
    dark: '#1b1e29', darkTop: '#2a2f3f',
    red: '#c8443c', blue: '#3fa9d8',
  };

  const Render = {
    cv: null, ctx: null, dpr: 1,
    map: null, cells: null, ing: null, recipes: null,
    scale: 32, ox: 0, oy: 0, lift: 6,
    pops: [], overlays: [], t: 0,
    meId: null, myTeam: 'A',
    aim: { x: 0, y: 0, active: false, canThrow: false },
    throwRange: 7,      // debe coincidir con THROW.maxRange del servidor

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

    resize() {
      if (!this.cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = this.cv.clientWidth || window.innerWidth;
      const h = this.cv.clientHeight || window.innerHeight;
      this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      if (!this.map) return;
      const padTop = 46, pad = 6;
      const s = Math.min((w - pad * 2) / this.map.w, (h - padTop - pad) / (this.map.h + 0.3));
      this.scale = s;
      this.lift = Math.max(3, s * 0.2);
      this.ox = (w - this.map.w * s) / 2;
      this.oy = padTop + (h - padTop - pad - this.map.h * s) / 2 + this.lift * 0.5;
    },

    // -------------------------------------------------------------- helpers
    rr(x, y, w, h, r) {
      const ctx = this.ctx;
      const rad = Math.min(r, w / 2, h / 2);
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

    /** Bloque solido con cara superior elevada (pseudo 3D). */
    block(x, y, sideCol, topCol, radius) {
      const s = this.scale, L = this.lift;
      const px = this.ox + x * s, py = this.oy + y * s;
      const ctx = this.ctx;
      ctx.fillStyle = sideCol;
      this.rr(px, py - L + 2, s, s + L - 2, radius || 3);
      ctx.fill();
      ctx.fillStyle = topCol;
      this.rr(px + 0.5, py - L, s - 1, s - 1, radius || 3);
      ctx.fill();
      return { px, py: py - L, s };
    },

    // ------------------------------------------------------------- escenario
    drawStatic() {
      const ctx = this.ctx, s = this.scale;

      // suelo
      for (let y = 0; y < this.map.h; y++) {
        for (let x = 0; x < this.map.w; x++) {
          const c = this.cellAt(x, y);
          if (c.type === 'wall') continue;
          ctx.fillStyle = (x + y) % 2 ? C.floorA : C.floorB;
          ctx.fillRect(this.ox + x * s, this.oy + y * s, s + 0.5, s + 0.5);
        }
      }
      // juntas
      ctx.strokeStyle = 'rgba(0,0,0,.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.map.w; x++) { ctx.moveTo(this.ox + x * s, this.oy); ctx.lineTo(this.ox + x * s, this.oy + this.map.h * s); }
      for (let y = 0; y <= this.map.h; y++) { ctx.moveTo(this.ox, this.oy + y * s); ctx.lineTo(this.ox + this.map.w * s, this.oy + y * s); }
      ctx.stroke();

      // alfombra decorativa
      (this.map.deco || []).filter((d) => d.type === 'rug').forEach((d) => {
        ctx.fillStyle = '#6b1f33';
        this.rr(this.ox + d.x * s, this.oy + d.y * s, d.w * s, d.h * s, 4);
        ctx.fill();
      });

      // bloques
      for (let y = 0; y < this.map.h; y++) {
        for (let x = 0; x < this.map.w; x++) this.drawTileBlock(this.cellAt(x, y));
      }

      // decorados
      (this.map.deco || []).forEach((d) => this.drawDeco(d));
    },

    drawTileBlock(c) {
      if (!c || !SOLID.has(c.type)) return;
      const ctx = this.ctx, s = this.scale;
      let b;
      switch (c.type) {
        case 'wall':
          b = this.block(c.x, c.y, '#171a24', C.wall, 2);
          ctx.fillStyle = C.wallTop;
          ctx.fillRect(b.px + 2, b.py + 2, b.s - 4, 2);
          break;
        case 'counter':
          b = this.block(c.x, c.y, C.woodSide, C.wood, 4);
          ctx.fillStyle = 'rgba(255,255,255,.18)';
          ctx.fillRect(b.px + 3, b.py + 3, b.s - 7, 2);
          break;
        case 'board':
          b = this.block(c.x, c.y, C.woodSide, C.wood, 4);
          ctx.fillStyle = C.red;
          this.rr(b.px + s * 0.14, b.py + s * 0.16, s * 0.72, s * 0.6, 3); ctx.fill();
          ctx.fillStyle = '#e8e8ee';
          ctx.fillRect(b.px + s * 0.2, b.py + s * 0.3, s * 0.45, 2);
          break;
        case 'crate':
          b = this.block(c.x, c.y, '#8a5f2c', '#c08a49', 4);
          ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
          ctx.strokeRect(b.px + 3, b.py + 3, b.s - 7, b.s - 7);
          this.glyph(this.ing[c.ing].emoji, b.px + b.s / 2, b.py + b.s / 2, s * 0.6);
          break;
        case 'cooker':
          b = this.block(c.x, c.y, '#5b6070', C.metal, 4);
          ctx.fillStyle = '#3d4253';
          ctx.beginPath(); ctx.arc(b.px + b.s / 2, b.py + b.s / 2, s * 0.33, 0, 7); ctx.fill();
          ctx.strokeStyle = '#c8cee0'; ctx.lineWidth = 2; ctx.stroke();
          break;
        case 'plates':
          b = this.block(c.x, c.y, C.woodSide, C.wood, 4);
          break;
        case 'sink':
          b = this.block(c.x, c.y, '#4a5164', '#6d7488', 4);
          ctx.fillStyle = '#2f4d63';
          this.rr(b.px + 3, b.py + 3, b.s - 6, b.s - 6, 4); ctx.fill();
          ctx.fillStyle = '#7fd3f5';
          this.rr(b.px + 5, b.py + 5, b.s - 10, b.s - 10, 3); ctx.fill();
          break;
        case 'return':
          b = this.block(c.x, c.y, C.woodSide, '#b58c56', 4);
          ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(b.px + b.s / 2, b.py + b.s / 2, s * 0.3, 0, 7); ctx.stroke();
          break;
        case 'trash':
          b = this.block(c.x, c.y, '#101219', '#20242f', 4);
          ctx.fillStyle = '#0a0b10';
          this.rr(b.px + 4, b.py + 4, b.s - 8, b.s - 8, 3); ctx.fill();
          ctx.fillStyle = '#5c6172';
          this.glyph('\u{1F5D1}', b.px + b.s / 2, b.py + b.s / 2, s * 0.5);
          break;
        case 'serve':
          b = this.block(c.x, c.y, '#0f1118', C.dark, 3);
          ctx.fillStyle = '#f4f4f8';
          this.glyph('\u{1F41F}', b.px + b.s / 2, b.py + b.s / 2, s * 0.55);
          break;
        default:
          break;
      }
    },

    drawDeco(d) {
      const ctx = this.ctx, s = this.scale;
      if (d.type === 'sign') {
        const x = this.ox + d.x * s, y = this.oy + d.y * s, w = d.w * s, h = d.h * s;
        ctx.fillStyle = '#0b1220';
        this.rr(x, y, w, h, 4); ctx.fill();
        ctx.strokeStyle = '#38d7ff'; ctx.lineWidth = 1.5;
        this.rr(x + 1.5, y + 1.5, w - 3, h - 3, 4); ctx.stroke();
        ctx.save();
        ctx.shadowColor = '#38d7ff'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#a9edff';
        ctx.font = `700 ${Math.max(8, h * 0.55)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.text, x + w / 2, y + h / 2);
        ctx.restore();
      } else if (d.type === 'sakura') {
        const cx = this.ox + d.x * s, cy = this.oy + d.y * s;
        ctx.fillStyle = '#f06fae';
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3, s * 0.3, 0, 7);
          ctx.fill();
        }
        ctx.fillStyle = '#ff8fc4';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.35, 0, 7); ctx.fill();
      } else if (d.type === 'lantern') {
        const cx = this.ox + d.x * s, cy = this.oy + d.y * s;
        ctx.fillStyle = '#e03c3c';
        ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.28, s * 0.36, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffd9a0';
        ctx.fillRect(cx - s * 0.05, cy - s * 0.36, s * 0.1, s * 0.72);
      }
    },

    // ---------------------------------------------------------------- frame
    draw(view, dt) {
      const ctx = this.ctx;
      this.t += dt;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      ctx.fillStyle = '#0c0d12';
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      if (!this.map) return;

      this.drawStatic();
      if (view) {
        this.drawGround(view.gnd);
        this.drawTileContents(view.tiles || {});
        this.drawAim(view);
        this.drawTarget(view);
        this.drawChefs(view.chefs || []);
        this.drawFlying(view.fly);
        this.drawOverlays();
      }
      this.drawPops(dt);
    },

    /** Ingredientes tirados por el suelo tras un mal lanzamiento. */
    drawGround(list) {
      if (!list || !list.length) return;
      const ctx = this.ctx, s = this.scale;
      for (const g of list) {
        const cx = this.ox + g.x * s, cy = this.oy + g.y * s;
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.12, s * 0.24, s * 0.12, 0, 0, 7); ctx.fill();
        ctx.save();
        ctx.globalAlpha = 0.85;
        this.drawItem(g.i, cx, cy, s * 0.6);
        ctx.restore();
      }
    },

    /** Ingredientes en el aire, con arco y sombra para leer donde van a caer. */
    drawFlying(list) {
      if (!list || !list.length) return;
      const ctx = this.ctx, s = this.scale;
      for (const f of list) {
        const cx = this.ox + f.x * s, cy = this.oy + f.y * s;
        const h = Math.sin(Math.min(1, f.p) * Math.PI) * s * 0.85;
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.1, s * 0.2, s * 0.1, 0, 0, 7); ctx.fill();
        ctx.save();
        ctx.translate(cx, cy - h);
        ctx.rotate(this.t * 7);
        this.drawItem(f.i, 0, 0, s * 0.8);
        ctx.restore();
      }
    },

    /** Linea de puntería mientras mantienes el joystick derecho con algo en la mano. */
    drawAim(view) {
      if (!this.aim.active || !this.aim.canThrow) return;
      const me = (view.chefs || []).find((c) => c.id === this.meId);
      if (!me) return;
      const m = Math.hypot(this.aim.x, this.aim.y);
      if (m < 0.15) return;
      const ux = this.aim.x / m, uy = this.aim.y / m;

      // avanza hasta el primer bloque o hasta el alcance maximo
      let d = 0.35, px = me.x + ux * d, py = me.y + uy * d;
      while (d < this.throwRange) {
        const nx = me.x + ux * (d + 0.15), ny = me.y + uy * (d + 0.15);
        if (this.solidAt(Math.floor(nx), Math.floor(ny))) break;
        px = nx; py = ny; d += 0.15;
      }

      const ctx = this.ctx, s = this.scale;
      const x0 = this.ox + me.x * s, y0 = this.oy + me.y * s;
      const x1 = this.ox + px * s, y1 = this.oy + py * s;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,209,102,.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.t * 22;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x1, y1, s * 0.22, 0, 7); ctx.stroke();
      ctx.restore();
    },

    /** Barras y avisos: se pintan por encima de los cocineros para que no queden tapados. */
    drawOverlays() {
      for (const o of this.overlays) {
        if (o.kind === 'bar') this.bar(o.x, o.y, o.w, o.h, o.p, o.col);
        else { this.ctx.fillStyle = o.col; this.glyph(o.text, o.x, o.y, o.size); }
      }
      this.overlays.length = 0;
    },

    drawTileContents(tiles) {
      const ctx = this.ctx, s = this.scale, L = this.lift;
      this.overlays.length = 0;
      for (const key in tiles) {
        const i = +key;
        const c = this.cells[i];
        if (!c) continue;
        const st = tiles[key];
        const px = this.ox + c.x * s, py = this.oy + c.y * s - L;
        const cx = px + s / 2, cy = py + s / 2;

        const barAt = (p, col) => this.overlays.push({ kind: 'bar', x: px + s * 0.12, y: py - 6, w: s * 0.76, h: 5, p, col });
        const iconAt = (text, col) => this.overlays.push({ kind: 'icon', text, col, x: cx, y: py - 6, size: s * 0.46 });

        if (c.type === 'counter' || c.type === 'board') {
          if (st.i) this.drawItem(st.i, cx, cy, s * 0.78);
          if (st.p > 0) barAt(st.p, '#ffd166');
        } else if (c.type === 'cooker') {
          const pot = st.pot;
          const col = pot.s === 'burnt' ? '#4a3428' : pot.s === 'cooked' ? '#fdfcf5' : '#f0ece0';
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, 7); ctx.fill();
          if (pot.s === 'cooking') barAt(pot.p, '#ff9f43');
          else if (pot.s === 'cooked') {
            barAt(pot.p, '#ff5757');                       // cuenta atras antes de quemarse
            if (Math.sin(this.t * 8) > 0) iconAt('✔', '#3ddc84');
          } else if (pot.s === 'burnt') {
            iconAt('\u{1F525}', '#ff5757');
          }
        } else if (c.type === 'sink') {
          if (st.d) { this.drawPlateStack(cx - s * 0.16, cy, s * 0.5, st.d, true); }
          if (st.c) { this.drawPlateStack(cx + s * 0.18, cy, s * 0.5, st.c, false); }
          if (st.p > 0) barAt(st.p, '#4dc9ff');
        } else if (c.type === 'return') {
          if (st.d) this.drawPlateStack(cx, cy, s * 0.62, st.d, true);
        } else if (c.type === 'plates') {
          if (st.n > 0) this.drawPlateStack(cx, cy, s * 0.68, st.n, false);
          else { ctx.fillStyle = '#8a6a3a'; this.glyph('∅', cx, cy, s * 0.5); }
        }
      }
    },

    drawPlateStack(cx, cy, size, n, dirty) {
      const ctx = this.ctx;
      const k = Math.min(n, 4);
      for (let i = 0; i < k; i++) {
        const y = cy - i * 2.2;
        ctx.fillStyle = dirty ? '#9a8f74' : '#f2f4f8';
        ctx.beginPath(); ctx.ellipse(cx, y, size * 0.5, size * 0.36, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = dirty ? '#6f6650' : '#c8ccd8'; ctx.lineWidth = 1; ctx.stroke();
      }
      if (n > 4) {
        ctx.fillStyle = '#20232e';
        ctx.font = `700 ${size * 0.38}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('x' + n, cx, cy - k * 2.2 - size * 0.05);
      }
    },

    drawItem(item, cx, cy, size) {
      const ctx = this.ctx;
      if (!item) return;
      if (item.k === 'p') {
        ctx.fillStyle = item.d ? '#9a8f74' : '#f2f4f8';
        ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.5, size * 0.38, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = item.d ? '#6f6650' : '#c3c8d4'; ctx.lineWidth = 1.2; ctx.stroke();
        if (item.d) { this.glyph('\u{1F4A6}', cx, cy, size * 0.4); return; }
        const n = item.c.length;
        item.c.forEach((t, i) => {
          const a = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
          const r = n === 1 ? 0 : size * 0.2;
          this.glyph(this.ing[t].emoji, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, size * (n > 2 ? 0.4 : 0.46));
        });
        return;
      }
      // ingrediente
      const meta = this.ing[item.t];
      const sz = size * 0.62;
      if (item.s === 'burnt') {
        ctx.fillStyle = '#2a2018';
        ctx.beginPath(); ctx.arc(cx, cy, sz * 0.5, 0, 7); ctx.fill();
        this.glyph('\u{1F525}', cx, cy, sz * 0.7);
        return;
      }
      this.glyph(meta.emoji, cx, cy, sz);
      if (item.s === 'chopped') {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.globalAlpha = .8;
        ctx.beginPath();
        ctx.moveTo(cx - sz * 0.3, cy - sz * 0.1); ctx.lineTo(cx + sz * 0.3, cy - sz * 0.1);
        ctx.moveTo(cx - sz * 0.3, cy + sz * 0.15); ctx.lineTo(cx + sz * 0.3, cy + sz * 0.15);
        ctx.stroke(); ctx.globalAlpha = 1;
      } else if (item.s === 'cooked') {
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.beginPath(); ctx.arc(cx, cy, sz * 0.55, 0, 7); ctx.fill();
      }
    },

    /** Marca la casilla a la que apunta tu cocinero. */
    drawTarget(view) {
      const me = (view.chefs || []).find((c) => c.id === this.meId);
      if (!me) return;
      const d = 0.34 + 0.45;
      const tx = Math.floor(me.x + me.fx * d), ty = Math.floor(me.y + me.fy * d);
      const c = this.cellAt(tx, ty);
      if (!c || !SOLID.has(c.type) || c.type === 'wall') return;
      const ctx = this.ctx, s = this.scale;
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.65 + Math.sin(this.t * 6) * 0.2;
      this.rr(this.ox + tx * s + 1, this.oy + ty * s - this.lift + 1, s - 2, s - 2, 4);
      ctx.stroke();
      ctx.restore();
    },

    drawChefs(chefs) {
      const ctx = this.ctx, s = this.scale;
      const list = chefs.slice().sort((a, b) => a.y - b.y);
      for (const ch of list) {
        const cx = this.ox + ch.x * s, cy = this.oy + ch.y * s;
        const col = chefColor(this.myTeam, ch.s);
        const r = s * 0.34;

        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.55, r * 0.95, r * 0.45, 0, 0, 7); ctx.fill();

        if (ch.d) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx - ch.fx * r, cy - ch.fy * r, r * 0.9, 0, 7); ctx.stroke();
        }

        // cuerpo
        const by = cy - r * 0.35;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx, by, r * 0.92, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.ellipse(cx + ch.fx * r * 0.15, by + r * 0.35 + ch.fy * r * 0.15, r * 0.55, r * 0.42, 0, 0, 7);
        ctx.fill();

        // gorro
        ctx.fillStyle = '#f6f8ff';
        ctx.beginPath(); ctx.ellipse(cx, by - r * 0.75, r * 0.7, r * 0.5, 0, 0, 7); ctx.fill();
        ctx.fillRect(cx - r * 0.62, by - r * 0.72, r * 1.24, r * 0.34);

        // mirada
        ctx.fillStyle = '#20232e';
        ctx.beginPath();
        ctx.arc(cx + ch.fx * r * 0.42, by + ch.fy * r * 0.42, r * 0.14, 0, 7);
        ctx.fill();

        // objeto en las manos
        if (ch.h) this.drawItem(ch.h, cx, by - r * 1.55, s * 0.72);

        // nombre (los bots llevan prefijo para distinguirlos de un vistazo)
        const label = ch.b ? '\u{1F916} ' + ch.n : ch.n;
        ctx.font = `600 ${Math.max(8, s * 0.3)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(label, cx, cy + r * 1.25);
        ctx.fillStyle = ch.id === this.meId ? '#ffd166' : ch.b ? '#b9c0d6' : '#e8ebf5';
        ctx.fillText(label, cx, cy + r * 1.25);
      }
    },

    bar(x, y, w, h, p, col) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      this.rr(x, y, w, h, h / 2); ctx.fill();
      ctx.fillStyle = col;
      this.rr(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, p)), h - 2, (h - 2) / 2); ctx.fill();
    },

    addEvents(evts) {
      const texts = {
        serve: null, bad: null, trash: '\u{1F5D1}', chop: '\u{2702}', wash: '\u{2728}',
        ready: '\u{1F514}', burn: '\u{1F525}', add: '+', hint: '?', expire: null,
        throw: '\u{1F4A8}', catch: '\u{1F44F}', land: '\u{2B07}',
      };
      (evts || []).forEach((e) => {
        if (e.e === 'expire') return; // se muestra como toast
        this.pops.push({
          x: e.x, y: e.y, life: 1,
          text: e.s || texts[e.e] || '',
          col: e.e === 'serve' || e.e === 'catch' ? '#3ddc84' : e.e === 'bad' ? '#ff6b6b' : '#ffffff',
        });
      });
    },

    drawPops(dt) {
      const ctx = this.ctx, s = this.scale;
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const p = this.pops[i];
        p.life -= dt * 1.1;
        if (p.life <= 0) { this.pops.splice(i, 1); continue; }
        const a = Math.min(1, p.life * 1.6);
        const px = this.ox + p.x * s, py = this.oy + p.y * s - this.lift - (1 - p.life) * s * 0.9;
        ctx.globalAlpha = a;
        ctx.font = `800 ${Math.max(10, s * 0.42)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(p.text, px, py);
        ctx.fillStyle = p.col;
        ctx.fillText(p.text, px, py);
        ctx.globalAlpha = 1;
      }
    },
  };

  global.Render = Render;
  global.TEAM_PALETTES = TEAM_PALETTES;
  global.chefColor = chefColor;
})(window);
