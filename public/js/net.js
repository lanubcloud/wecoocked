/* Capa de red: socket.io + buffer de snapshots para interpolacion. */
(function (global) {
  'use strict';

  const Net = {
    socket: null,
    id: null,
    name: 'Chef',
    room: null,
    handlers: {},
    ping: 0,
    _lastInputSent: 0,

    on(evt, fn) { (this.handlers[evt] || (this.handlers[evt] = [])).push(fn); return this; },
    emitLocal(evt, data) { (this.handlers[evt] || []).forEach((f) => f(data)); },

    connect(name) {
      this.name = name;
      this.socket = io({ transports: ['websocket', 'polling'] });
      const s = this.socket;

      s.on('connect', () => {
        this.id = s.id;
        s.emit('hello', { name: this.name }, (res) => {
          if (res && res.name) this.name = res.name;
          this.emitLocal('ready', res);
        });
      });

      s.on('disconnect', (r) => this.emitLocal('disconnected', r));
      ['room:state', 'room:left', 'match:start', 'state', 'match:end', 'toast',
       'voice:peers', 'voice:signal', 'voice:left'].forEach((evt) => {
        s.on(evt, (d) => this.emitLocal(evt, d));
      });

      setInterval(() => {
        if (!s.connected) return;
        const t0 = performance.now();
        s.emit('ping:cli', null, () => { this.ping = Math.round(performance.now() - t0); });
      }, 3000);
      return this;
    },

    create(name, teamSize) {
      return new Promise((res) => this.socket.emit('room:create', { name, teamSize }, res));
    },
    join(code, name) {
      return new Promise((res) => this.socket.emit('room:join', { code, name }, res));
    },
    leave() { this.socket.emit('room:leave'); },
    setTeam(team) { this.socket.emit('room:setTeam', { team }); },
    setTeamSize(size) { this.socket.emit('room:setTeamSize', { size }); },
    addBot(team, level) { this.socket.emit('room:addBot', { team, level }); },
    removeBot(id) { this.socket.emit('room:removeBot', { id }); },
    setBotLevel(level) { this.socket.emit('room:botLevel', { level }); },
    setReady(ready) { this.socket.emit('room:ready', { ready }); },
    start() { this.socket.emit('room:start'); },

    sendInput(inp) {
      if (!this.socket || !this.socket.connected) return;
      // Emision normal a proposito: con `volatile` socket.io descarta los paquetes
      // cuando el transporte no esta "writable" y el cocinero se queda congelado.
      // Son ~20 paquetes/s de unos 60 bytes, el ahorro no compensa el riesgo.
      this.socket.emit('input', inp);
    },
    act() { if (this.socket) this.socket.emit('act'); },
    dash() { if (this.socket) this.socket.emit('dash'); },
    throwItem(dx, dy) { if (this.socket) this.socket.emit('throw', { dx, dy }); },

    voiceEnable(on) { if (this.socket) this.socket.emit('voice:enable', { on }); },
    voiceSignal(to, data) { if (this.socket) this.socket.emit('voice:signal', { to, data }); },
  };

  global.Net = Net;
})(window);
