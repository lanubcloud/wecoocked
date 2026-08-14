/* Pantallas, lobby, HUD y utilidades de interfaz. */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  const UI = {
    screen: 'menu',
    recipes: {},
    ing: {},
    ticketCache: new Map(),

    show(name) {
      $$('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
      this.screen = name;
      document.body.classList.toggle('needs-landscape', name === 'game' && this.isPortrait());
    },

    isPortrait() {
      return window.innerHeight > window.innerWidth * 1.05;
    },

    checkOrientation() {
      document.body.classList.toggle('needs-landscape', this.screen === 'game' && this.isPortrait());
    },

    toast(msg, ms) {
      const el = $('#toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => el.classList.remove('show'), ms || 1600);
    },

    // ------------------------------------------------------------- lobby
    renderLobby(st, myId) {
      $('#lobby-code').textContent = st.code;
      ['A', 'B'].forEach((t) => {
        const ul = $('#team-' + t);
        ul.innerHTML = '';
        const isHost = st.host === myId;
        st.players.filter((p) => p.team === t).forEach((p, i) => {
          const li = document.createElement('li');
          const color = global.chefColor ? global.chefColor(t, i) : '#ff5757';
          const tag = p.bot
            ? `<span class="tag bot">BOT ${escapeHtml(p.level || '')}</span>`
            : `<span class="tag ${p.ready ? 'ready' : ''}">${p.id === st.host ? 'HOST' : p.ready ? 'LISTO' : 'esperando'}</span>`;
          li.innerHTML =
            `<span class="dot" style="background:${color}"></span>` +
            `<span>${p.bot ? '\u{1F916} ' : ''}${escapeHtml(p.name)}${p.id === myId ? ' (tu)' : ''}</span>` +
            `<span class="mic">${p.voice ? '\u{1F3A4}' : ''}</span>` + tag +
            (p.bot && isHost ? `<button class="kick" data-bot="${p.id}" aria-label="Quitar bot">&times;</button>` : '');
          ul.appendChild(li);
        });
        const count = st.players.filter((p) => p.team === t).length;
        const full = count >= st.teamSize;
        const mine = st.players.find((p) => p.id === myId);
        const btn = $(`.join-team[data-team="${t}"]`);
        btn.disabled = full || (mine && mine.team === t);
        btn.textContent = mine && mine.team === t ? 'Tu equipo' : full ? 'Completo' : 'Unirme';
        const botBtn = $(`.add-bot[data-team="${t}"]`);
        botBtn.style.display = isHost ? '' : 'none';
        botBtn.disabled = full;
      });

      const isHost = st.host === myId;
      $('#btn-start').style.display = isHost ? '' : 'none';
      $('#seg-size').style.display = isHost ? '' : 'none';
      $('#seg-level').style.display = isHost ? '' : 'none';
      $$('.size-opt').forEach((b) => b.classList.toggle('on', +b.dataset.size === st.teamSize));
      $$('.level-opt').forEach((b) => b.classList.toggle('on', b.dataset.level === st.botLevel));

      const me = st.players.find((p) => p.id === myId);
      $('#btn-ready').classList.toggle('on', !!(me && me.ready));
      $('#btn-ready').textContent = me && me.ready ? 'Listo ✓' : 'Listo';
      $('#btn-ready').style.display = isHost ? 'none' : '';

      const a = st.players.filter((p) => p.team === 'A').length;
      const b = st.players.filter((p) => p.team === 'B').length;
      $('#lobby-hint').textContent =
        a === 0 || b === 0
          ? 'Cada equipo necesita al menos 1 jugador o bot. Usa "+ Bot" para rellenar.'
          : `Rojo ${a}/${st.teamSize} · Azul ${b}/${st.teamSize}. Comparte el codigo ${st.code}.`;
    },

    // --------------------------------------------------------------- HUD
    setMatchMeta(meta, myTeam) {
      this.recipes = {};
      (meta.recipes || []).forEach((r) => { this.recipes[r.id] = r; });
      this.ing = meta.ingredients;
      const other = myTeam === 'A' ? 'B' : 'A';
      $('#sb-me-name').textContent = meta.teamMeta[myTeam].name;
      $('#sb-op-name').textContent = meta.teamMeta[other].name;
      $('.sb-me').style.borderLeftColor = meta.teamMeta[myTeam].color;
      $('.sb-op').style.borderLeftColor = meta.teamMeta[other].color;
      this.ticketCache.clear();
      $('#orders').innerHTML = '';
    },

    renderOrders(orders) {
      const wrap = $('#orders');
      const seen = new Set();
      orders.forEach((o, i) => {
        seen.add(o.id);
        let el = this.ticketCache.get(o.id);
        if (!el) {
          const r = this.recipes[o.r];
          el = document.createElement('div');
          el.className = 'ticket';
          // mismo arte que en la cocina, para que el pedido y el cajon coincidan
          const plato = r ? `<img class="dish" alt="" src="${global.Render.dishIcon(r.items, 72)}">` : '';
          const ings = r ? r.items.map((t) => {
            const prep = this.ing[t].prep;
            const st = prep === 'cook' ? 'cooked' : prep === 'chop' ? 'chopped' : 'raw';
            return `<img alt="" src="${global.Render.iconFor(t, st, 36)}">`;
          }).join('') : '';
          el.innerHTML = `<div class="bar"><i></i></div>${plato}<div class="ings">${ings}</div>`;
          this.ticketCache.set(o.id, el);
          wrap.appendChild(el);
        }
        el.style.order = i;
        el.querySelector('.bar i').style.width = (o.t * 100).toFixed(0) + '%';
        el.classList.toggle('warn', o.t <= 0.45 && o.t > 0.2);
        el.classList.toggle('crit', o.t <= 0.2);
      });
      for (const [id, el] of this.ticketCache) {
        if (!seen.has(id)) { el.remove(); this.ticketCache.delete(id); }
      }
      // Con la cola llena los tickets se encogen para que quepan todos: es
      // peor perder de vista un pedido que verlos algo mas pequenos.
      wrap.classList.toggle('many', orders.length >= 4);
    },

    renderHud(state, myTeam) {
      const left = Math.max(0, state.left || 0);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      const t = $('#timer');
      t.textContent = `${m}:${String(s).padStart(2, '0')}`;
      t.classList.toggle('low', left <= 30);

      const other = myTeam === 'A' ? 'B' : 'A';

      // Platos servidos por cada equipo. Es el unico numero del marcador: los
      // puntos iban al lado y solo confundian, porque lo que decide quien gana
      // son los platos.
      const mine = state.plates ? (state.plates[myTeam] | 0) : (state.delivered | 0);
      const theirs = state.plates && state.plates[other] != null ? state.plates[other] : null;
      $('#pl-me').textContent = mine;
      $('#pl-op').textContent = theirs == null ? '-' : theirs;

      const diff = $('#sb-diff');
      if (theirs == null) { diff.textContent = ''; diff.className = 'sb-diff'; }
      else {
        const d = mine - theirs;
        diff.textContent = d > 0 ? `+${d} platos` : d < 0 ? `${d} platos` : 'empate';
        diff.className = 'sb-diff ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'tie');
      }

      this.renderOrders(state.orders || []);
    },

    countdown(n) {
      const el = $('#countdown');
      if (n <= 0) { el.classList.remove('show'); return; }
      el.classList.add('show');
      el.textContent = n <= 1 ? '¡YA!' : String(n - 1);
    },

    // ---------------------------------------------------------- resultados
    renderResults(res, myTeam) {
      const body = $('#res-body');
      body.innerHTML = '';
      const names = { A: 'Equipo Rojo', B: 'Equipo Azul' };
      ['A', 'B'].forEach((t) => {
        const d = res.teams[t];
        if (!d) return;
        const card = document.createElement('div');
        card.className = 'res-card' + (res.winner === t ? ' win' : '');
        card.innerHTML =
          `<h3>${d.name || names[t]}${t === myTeam ? ' (tu equipo)' : ''}</h3>` +
          `<div class="big">${d.score}</div>` +
          `<ul><li>Platos servidos: ${d.delivered}</li><li>Fallos: ${d.failed}</li>` +
          `<li>Mejor racha: x${d.bestCombo}</li><li>${(d.players || []).join(', ')}</li></ul>`;
        body.appendChild(card);
      });
      $('#res-title').textContent =
        res.winner === 'tie' ? '¡Empate!' :
        res.winner === myTeam ? '¡Victoria!' : 'Derrota';
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  global.UI = UI;
  global.$ = $;
  global.$$ = $$;
})(window);
