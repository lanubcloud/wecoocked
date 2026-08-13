/* Arranque, bucle de juego, prediccion local e interpolacion. */
(function () {
  'use strict';

  // Valores por defecto; el servidor manda los suyos en match:start para que
  // la prediccion local use exactamente los mismos numeros que la simulacion.
  let CHEF_SPEED = 6.2;
  let CHEF_R = 0.34;
  const INTERP_MIN = 55;    // margen minimo de interpolacion
  const INTERP_MAX = 160;

  const G = {
    myTeam: 'A',
    holding: null,     // lo que lleva el cocinero local, segun el ultimo snapshot
    roomState: null,
    meta: null,
    buffer: [],        // [{t, chefs}]
    latest: null,
    me: null,          // prediccion local {x,y,fx,fy}
    countdown: 0,
    playing: false,
    lastFrame: 0,
    wakeLock: null,
    gaps: [],          // separacion entre snapshots, para medir el jitter
    lastSnapAt: 0,
    interp: 110,       // retardo de interpolacion, se ajusta solo
  };

  /**
   * Retardo de interpolacion adaptativo.
   *
   * Para dibujar a los demas cocineros hay que ir un poco "por detras" del
   * ultimo snapshot recibido, o al primer paquete que llegue tarde se
   * congelarian. Ese margen se sumaba antes como 110 ms fijos, pensados para
   * el peor caso. Si la conexion es estable no hacen falta: basta con un
   * snapshot mas el jitter real medido, y cada milisegundo que se recorta
   * aqui es un milisegundo menos de retardo al ver a tus companeros.
   */
  function updateInterp() {
    if (G.gaps.length < 6) return;
    const s = G.gaps.slice().sort((a, b) => a - b);
    const mediana = s[s.length >> 1];
    const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    const jitter = Math.max(0, p90 - mediana);
    const objetivo = Math.max(INTERP_MIN, Math.min(INTERP_MAX, mediana + jitter * 1.5 + 8));
    G.interp += (objetivo - G.interp) * 0.1;   // suavizado, para que no de saltos
  }

  // ------------------------------------------------------------- utilidades
  function saveName(n) { try { localStorage.setItem('wc_name', n); } catch (_) {} }
  function loadName() { try { return localStorage.getItem('wc_name') || ''; } catch (_) { return ''; } }

  async function goFullscreen() {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    } catch (_) {}
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (_) {}
    try {
      if ('wakeLock' in navigator) G.wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  }

  function blocked(x, y) {
    const x0 = Math.floor(x - CHEF_R), x1 = Math.floor(x + CHEF_R);
    const y0 = Math.floor(y - CHEF_R), y1 = Math.floor(y + CHEF_R);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (Render.solidAt(tx, ty)) return true;
    return false;
  }

  // ---------------------------------------------------------------- pantallas
  function bindMenu() {
    const nameInput = $('#inp-name');
    nameInput.value = loadName();

    $('#btn-create').addEventListener('click', async () => {
      const name = (nameInput.value || 'Chef').trim();
      saveName(name);
      const res = await Net.create(name, 2);
      if (!res || !res.ok) { alert((res && res.err) || 'No se pudo crear la sala'); return; }
      UI.show('lobby');
    });

    $('#btn-join').addEventListener('click', async () => {
      const name = (nameInput.value || 'Chef').trim();
      const code = ($('#inp-code').value || '').toUpperCase().trim();
      if (code.length !== 4) { alert('Introduce el codigo de 4 letras'); return; }
      saveName(name);
      const res = await Net.join(code, name);
      if (!res || !res.ok) { alert((res && res.err) || 'No se pudo entrar'); return; }
      UI.show('lobby');
    });

    // ?sala=XXXX en la URL rellena el codigo
    const qs = new URLSearchParams(location.search);
    if (qs.get('sala')) $('#inp-code').value = qs.get('sala').toUpperCase().slice(0, 4);

    bindInstall();
  }

  /**
   * Instalacion en el dispositivo. Al instalarlo, el service worker sirve el
   * juego desde el almacenamiento local: no vuelve a descargar nada y arranca
   * al instante.
   */
  function bindInstall() {
    const btn = $('#btn-install');
    let prompt = null;

    // Ya instalado: no hay nada que ofrecer.
    const instalado = window.matchMedia('(display-mode: standalone)').matches ||
                      window.matchMedia('(display-mode: fullscreen)').matches ||
                      window.navigator.standalone === true;
    if (instalado) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();          // usamos nuestro boton, no el del navegador
      prompt = e;
      btn.hidden = false;
      btn.textContent = 'Instalar el juego';
    });
    window.addEventListener('appinstalled', () => { btn.hidden = true; prompt = null; });

    // Chrome solo lanza beforeinstallprompt si le da la gana (necesita
    // interaccion previa, y en iPhone no existe). Si no llega, se ensena el
    // boton igualmente con las instrucciones manuales: mas vale explicarlo
    // que dejar al jugador sin forma de instalarlo.
    setTimeout(() => {
      if (prompt || !btn.hidden) return;
      btn.hidden = false;
      btn.textContent = 'Como instalar el juego';
    }, 2500);

    btn.addEventListener('click', async () => {
      if (prompt) {
        btn.disabled = true;
        prompt.prompt();
        await prompt.userChoice;
        prompt = null;
        btn.hidden = true;
        btn.disabled = false;
        return;
      }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      alert(ios
        ? 'En iPhone o iPad:\n\n1. Toca el boton Compartir (el cuadrado con la flecha)\n2. Baja y elige "Anadir a pantalla de inicio"\n3. Toca Anadir'
        : 'En Android:\n\n1. Abre el menu del navegador (los tres puntos)\n2. Elige "Instalar aplicacion" o "Anadir a pantalla de inicio"\n3. Confirma');
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e.message));
    }
  }

  function bindLobby() {
    $('#btn-leave').addEventListener('click', () => { Net.leave(); Voice.disable(); UI.show('menu'); });

    $('#btn-copy').addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?sala=${G.roomState ? G.roomState.code : ''}`;
      const done = () => UI.toast('Link copiado');
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copia el link:', url));
      else prompt('Copia el link:', url);
    });

    $$('.join-team').forEach((b) => b.addEventListener('click', () => Net.setTeam(b.dataset.team)));
    $$('.size-opt').forEach((b) => b.addEventListener('click', () => Net.setTeamSize(+b.dataset.size)));
    $$('.add-bot').forEach((b) => b.addEventListener('click', () => Net.addBot(b.dataset.team)));
    $$('.level-opt').forEach((b) => b.addEventListener('click', () => Net.setBotLevel(b.dataset.level)));

    // la "x" de cada bot se crea al vuelo, asi que delegamos el click
    document.querySelector('.teams').addEventListener('click', (e) => {
      const k = e.target.closest('.kick');
      if (k) Net.removeBot(k.dataset.bot);
    });

    $('#btn-ready').addEventListener('click', () => {
      const me = G.roomState && G.roomState.players.find((p) => p.id === Net.id);
      Net.setReady(!(me && me.ready));
    });

    $('#btn-start').addEventListener('click', async () => { await goFullscreen(); Net.start(); });

    $('#btn-mic').addEventListener('click', async () => {
      if (Voice.enabled) { Voice.disable(); return; }
      const ok = await Voice.enable();
      if (!ok) alert('No se pudo acceder al microfono.\nRevisa los permisos del navegador y que la web se sirva por HTTPS.');
    });
  }

  function bindGame() {
    Input.onAct = () => Net.act();
    Input.onDash = () => Net.dash();
    Input.onChop = () => Net.chop();
    Input.onThrow = (dx, dy) => {
      // solo tiene sentido con un ingrediente en la mano (el servidor lo revalida)
      if (!G.holding || G.holding.k !== 'i') return;
      Net.throwItem(dx, dy);
    };

    $('#btn-menu').addEventListener('click', () => $('#pause').classList.add('show'));
    $('#btn-resume').addEventListener('click', () => $('#pause').classList.remove('show'));
    $('#btn-quit').addEventListener('click', () => {
      $('#pause').classList.remove('show');
      Net.leave(); Voice.disable(); UI.show('menu');
    });

    $('#opt-aim').addEventListener('change', (e) => Input.setAimEnabled(e.target.checked));
    $('#opt-throw').addEventListener('change', (e) => { Input.throwEnabled = e.target.checked; });
    $('#opt-haptic').addEventListener('change', (e) => { Input.haptic = e.target.checked; });
    $('#opt-ptt').addEventListener('change', (e) => {
      Voice.setPtt(e.target.checked);
      updateMicBtn();
    });

    const mic = $('#btn-ptt');
    mic.addEventListener('pointerdown', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!Voice.enabled) {
        const ok = await Voice.enable();
        if (!ok) UI.toast('Micro no disponible');
        updateMicBtn();
        return;
      }
      if (Voice.ptt) { Voice.pttDown(); updateMicBtn(); }
      else { Voice.toggleMute(); updateMicBtn(); }
    }, { passive: false });
    mic.addEventListener('pointerup', () => { if (Voice.ptt) { Voice.pttUp(); updateMicBtn(); } });
    mic.addEventListener('pointercancel', () => { if (Voice.ptt) { Voice.pttUp(); updateMicBtn(); } });

    $('#btn-back').addEventListener('click', () => UI.show('lobby'));
  }

  /**
   * El boton de accion dice lo que va a hacer segun lo que tengas delante:
   * COGER, DEJAR, CORTA, FREGAR, SERVIR... Es la guia de juego integrada en
   * el propio control, sin tutorial.
   */
  function updateActionBtn() {
    if (UI.screen !== 'game') return;
    const el = $('#btn-a');
    if (!el) return;
    const ic = el.querySelector('.ic');
    const lb = el.querySelector('.lb');
    let icon = '✋', label = 'ACCION';

    const me = G.me;
    if (me && Render.map && G.latest) {
      const f = Render.frontTile(me);
      const cell = f && Render.cellAt(f.x, f.y);
      const st = f && G.latest.tiles ? G.latest.tiles[f.y * Render.map.w + f.x] : null;
      const h = G.holding;
      if (cell) {
        switch (cell.type) {
          case 'crate': if (!h) { icon = '✋'; label = 'COGER'; } break;
          case 'board':
            if (!h && st && st.i && st.i.s === 'raw') { icon = '\u{1F52A}'; label = 'CORTA'; }
            else if (!h && st && st.i) { icon = '✋'; label = 'COGER'; }
            else if (h) { icon = '⬇'; label = 'DEJAR'; }
            break;
          case 'counter':
            if (h) { icon = '⬇'; label = h.k === 'i' && st && st.i && st.i.k === 'p' ? 'EMPLATA' : 'DEJAR'; }
            else if (st && st.i) { icon = '✋'; label = 'COGER'; }
            break;
          case 'cooker':
            if (h && h.k === 'i' && h.t === 'rice' && h.s === 'raw' && !st) { icon = '\u{1F35A}'; label = 'COCER'; }
            else if (!h && st && st.pot && st.pot.s !== 'cooking') { icon = '✋'; label = 'SACAR'; }
            break;
          case 'plates': if (!h && (!st || st.n > 0)) { icon = '\u{1F37D}'; label = 'PLATO'; } break;
          case 'sink':
            if (h && h.k === 'p' && h.d) { icon = '⬇'; label = 'DEJAR'; }
            else if (!h && st && st.c > 0) { icon = '✋'; label = 'COGER'; }
            else if (!h && st && st.d > 0) { icon = '\u{1F9FD}'; label = 'MANTEN'; }
            break;
          case 'return':
            if (!h && st && st.d > 0) { icon = '✋'; label = 'COGER'; }
            else if (h && h.k === 'p' && h.d) { icon = '⬇'; label = 'DEJAR'; }
            break;
          case 'trash': if (h) { icon = '\u{1F5D1}'; label = 'TIRAR'; } break;
          case 'serve': if (h && h.k === 'p' && !h.d && h.c.length) { icon = '\u{1F6CE}'; label = 'SERVIR'; } break;
          default: break;
        }
      } else if (G.holding) { icon = '✋'; label = 'ACCION'; }
    }
    if (ic.textContent !== icon) ic.textContent = icon;
    if (lb.textContent !== label) lb.textContent = label;
  }

  function updateMicBtn() {
    const el = $('#btn-ptt');
    if (!el) return;
    const on = Voice.enabled && !Voice.muted;
    el.classList.toggle('on', on);
    el.classList.toggle('talking', Voice.enabled && Voice.speaking);
    el.textContent = !Voice.enabled ? 'MIC' : Voice.ptt ? 'PTT' : on ? 'ON' : 'OFF';
    const n = Voice.peers.size;
    // 'ws' = WebSocket (lo bueno). 'polling' = modo lento, hay algo que revisar.
    const tr = Net.transport() === 'websocket' ? 'ws' : Net.transport();
    $('#netstat').textContent =
      `${Net.ping}ms · ${tr} · buffer ${Math.round(G.interp)}ms · voz ${Voice.enabled ? n : 'off'}`;
  }

  // ------------------------------------------------------------------ red
  function bindNet() {
    Net.on('room:state', (st) => {
      G.roomState = st;
      const me = st.players.find((p) => p.id === Net.id);
      if (me) G.myTeam = me.team;
      if (UI.screen === 'lobby' || UI.screen === 'menu') UI.renderLobby(st, Net.id);
      $('#btn-mic').classList.toggle('on', Voice.enabled);
      $('#btn-mic').textContent = Voice.enabled ? 'Micro activo' : 'Activar micro';
    });

    Net.on('room:left', () => { G.roomState = null; });

    Net.on('match:start', async (meta) => {
      G.meta = meta;
      if (meta.chef) { CHEF_SPEED = meta.chef.speed; CHEF_R = meta.chef.radius; }
      G.buffer.length = 0;
      G.latest = null;
      G.me = null;
      G.playing = false;
      G.countdown = meta.countdown;
      Render.meId = Net.id;
      Render.myTeam = G.myTeam;
      Render.setMap(meta.map, meta.ingredients, meta.recipes);
      UI.setMatchMeta(meta, G.myTeam);
      UI.show('game');
      Input.reset();
      await goFullscreen();
      Render.resize();
      UI.countdown(G.countdown);
      const iv = setInterval(() => {
        G.countdown -= 1;
        UI.countdown(G.countdown);
        if (G.countdown <= 0) { clearInterval(iv); UI.countdown(0); G.playing = true; }
      }, 1000);
    });

    Net.on('state', (snap) => {
      const now = performance.now();
      if (G.lastSnapAt) {
        G.gaps.push(now - G.lastSnapAt);
        while (G.gaps.length > 24) G.gaps.shift();
        updateInterp();
      }
      G.lastSnapAt = now;
      G.latest = snap;
      G.buffer.push({ t: now, chefs: snap.chefs });
      while (G.buffer.length > 20) G.buffer.shift();
      Render.addEvents(snap.ev);
      (snap.ev || []).forEach((e) => {
        if (e.e === 'expire') UI.toast('¡Pedido perdido! ' + e.s);
        else if (e.e === 'serve') Input.buzz(25);
        else if (e.e === 'bad' && e.s) UI.toast(e.s, 900);
      });
      const srv = snap.chefs.find((c) => c.id === Net.id);
      G.holding = srv ? srv.h : null;
      if (srv) {
        if (!G.me) G.me = { x: srv.x, y: srv.y, fx: srv.fx, fy: srv.fy };
        else {
          const d = Math.hypot(srv.x - G.me.x, srv.y - G.me.y);
          if (d > 1.2) { G.me.x = srv.x; G.me.y = srv.y; }
          else { G.me.x += (srv.x - G.me.x) * 0.22; G.me.y += (srv.y - G.me.y) * 0.22; }
        }
      }
    });

    Net.on('match:end', (res) => {
      G.playing = false;
      UI.renderResults(res, G.myTeam);
      UI.show('results');
      Input.reset();
    });

    Net.on('toast', (d) => UI.toast(d.msg));
    Net.on('voice:peers', (d) => Voice.syncPeers(d.peers || []));
    Net.on('voice:signal', (d) => Voice.onSignal(d));
    Net.on('voice:left', (d) => Voice.dropPeer(d.id));
    Net.on('disconnected', () => UI.toast('Conexion perdida...', 4000));
  }

  // --------------------------------------------------------------- bucle
  function sampleChefs(renderTime) {
    const buf = G.buffer;
    if (!buf.length) return [];
    if (buf.length === 1) return buf[0].chefs;
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > renderTime) i--;
    const a = buf[i], b = buf[Math.min(i + 1, buf.length - 1)];
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.t) / span)) : 1;
    const out = [];
    for (const cb of b.chefs) {
      const ca = a.chefs.find((c) => c.id === cb.id) || cb;
      out.push({
        id: cb.id, n: cb.n, s: cb.s, h: cb.h, d: cb.d, b: cb.b,
        x: ca.x + (cb.x - ca.x) * f,
        y: ca.y + (cb.y - ca.y) * f,
        fx: cb.fx, fy: cb.fy,
      });
    }
    return out;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (G.lastFrame || now)) / 1000);
    G.lastFrame = now;

    // Fuera de la partida no hay nada que animar: no gastes bateria.
    if (UI.screen !== 'game' || document.hidden) return;

    let view = null;
    if (G.latest) {
      const chefs = sampleChefs(now - G.interp);
      // prediccion local del propio cocinero
      if (G.me && G.playing) {
        const inp = Input.snapshot();
        const m = Math.hypot(inp.mx, inp.my);
        if (m > 0.001) {
          const nx = G.me.x + (inp.mx / Math.max(1, m)) * CHEF_SPEED * dt;
          const ny = G.me.y + (inp.my / Math.max(1, m)) * CHEF_SPEED * dt;
          if (!blocked(nx, G.me.y)) G.me.x = nx;
          if (!blocked(G.me.x, ny)) G.me.y = ny;
        }
        const a = Math.hypot(inp.ax, inp.ay);
        if (a > 0.35) { G.me.fx = inp.ax / a; G.me.fy = inp.ay / a; }
        else if (m > 0.15) { G.me.fx = inp.mx / m; G.me.fy = inp.my / m; }

        const mine = chefs.find((c) => c.id === Net.id);
        if (mine) { mine.x = G.me.x; mine.y = G.me.y; mine.fx = G.me.fx; mine.fy = G.me.fy; }
      }
      Render.aim.x = Input.aim.x;
      Render.aim.y = Input.aim.y;
      Render.aim.active = Input.aim.pointer !== null && Math.hypot(Input.aim.x, Input.aim.y) > 0.15;
      Render.aim.canThrow = Input.throwEnabled && !!G.holding && G.holding.k === 'i';

      view = { chefs, tiles: G.latest.tiles, orders: G.latest.orders, fly: G.latest.fly, gnd: G.latest.gnd };
      // El HUD son escrituras al DOM y recalculo de estilos. El reloj cambia
      // 10 veces por segundo, no 60: refrescarlo en cada fotograma era trabajo
      // tirado que ademas calienta el movil.
      if (now - (G.lastHud || 0) > 100) { G.lastHud = now; UI.renderHud(G.latest, G.myTeam); }
    }
    Render.draw(view, dt);
  }

  // ---------------------------------------------------------------- inicio
  function boot() {
    Render.init(document.getElementById('cv'));
    Input.init();
    Voice.onState = updateMicBtn;
    bindMenu(); bindLobby(); bindGame(); bindNet();

    Net.connect(loadName() || 'Chef');

    // Envio de input a 30 Hz aunque el servidor simule a 20: asi el estado del
    // joystick que lee cada tick es mas reciente. Son 60 bytes por paquete,
    // cuesta 0,6 KB/s de nada y recorta la espera media hasta que tu accion
    // entra en la simulacion.
    setInterval(() => { if (UI.screen === 'game' && G.playing) Net.sendInput(Input.snapshot()); }, 33);
    setInterval(updateMicBtn, 1000);
    setInterval(updateActionBtn, 140);

    window.addEventListener('resize', () => { UI.checkOrientation(); Render.resize(); });
    window.addEventListener('orientationchange', () => setTimeout(() => { UI.checkOrientation(); Render.resize(); }, 300));
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !G.wakeLock && 'wakeLock' in navigator) {
        try { G.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
      }
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

    UI.show('menu');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
