'use strict';

const { TICK_HZ, DT, MATCH_SECONDS, COUNTDOWN_SECONDS } = require('./game/config');
const { buildMap } = require('./game/map');
const { INGREDIENTS, RECIPES } = require('./game/recipes');
const { Engine } = require('./game/engine');
const { LEVELS } = require('./game/bot');

const BOT_NAMES = ['Kenji', 'Yuki', 'Hana', 'Taro', 'Mei', 'Ryo'];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAMS = ['A', 'B'];
const TEAM_META = { A: { name: 'Equipo Rojo', color: '#ff5757' }, B: { name: 'Equipo Azul', color: '#4aa8ff' } };
const MAP = buildMap();

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function sanitizeName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14);
  return s || 'Chef';
}

class Room {
  constructor(mgr, code, hostId, teamSize) {
    this.mgr = mgr;
    this.io = mgr.io;
    this.code = code;
    this.hostId = hostId;
    this.teamSize = Math.min(3, Math.max(2, teamSize | 0 || 2));
    this.players = new Map(); // id -> { id, name, team, ready, voice }
    this.phase = 'lobby';     // lobby | countdown | playing | results
    this.engines = {};
    this.timer = 0;
    this.loop = null;
    this.lastResults = null;
    this.botSeq = 0;
    this.botLevel = 'normal';
  }

  humans() { return [...this.players.values()].filter((p) => !p.bot); }

  /** El host anade un bot a un equipo. Los bots ocupan plaza como un jugador mas. */
  addBot(hostId, team, level) {
    if (hostId !== this.hostId || this.phase !== 'lobby') return;
    if (!TEAMS.includes(team)) return;
    if (this.teamPlayers(team).length >= this.teamSize) {
      this.io.to(hostId).emit('toast', { msg: `El ${TEAM_META[team].name} ya esta completo`, kind: 'warn' });
      return;
    }
    const lvl = LEVELS[level] ? level : this.botLevel;
    const id = `bot:${this.code}:${++this.botSeq}`;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${this.botSeq}`;
    this.players.set(id, { id, name, team, ready: true, voice: false, bot: true, level: lvl });
    this.pushState();
  }

  removeBot(hostId, botId) {
    if (hostId !== this.hostId || this.phase !== 'lobby') return;
    const p = this.players.get(botId);
    if (!p || !p.bot) return;
    this.players.delete(botId);
    this.pushState();
  }

  setBotLevel(hostId, level) {
    if (hostId !== this.hostId || this.phase !== 'lobby') return;
    if (!LEVELS[level]) return;
    this.botLevel = level;
    for (const p of this.players.values()) if (p.bot) p.level = level;
    this.pushState();
  }

  get capacity() { return this.teamSize * 2; }
  chan(team) { return `r:${this.code}:${team}`; }

  teamPlayers(team) {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  add(socket, name) {
    if (this.players.size >= this.capacity) return { ok: false, err: 'La sala esta llena' };
    if (this.phase === 'playing' || this.phase === 'countdown') return { ok: false, err: 'La partida ya ha empezado' };

    const a = this.teamPlayers('A').length;
    const b = this.teamPlayers('B').length;
    const team = a <= b ? 'A' : 'B';

    const p = { id: socket.id, name: sanitizeName(name), team, ready: false, voice: false };
    this.players.set(p.id, p);
    socket.join(`r:${this.code}`);
    socket.join(this.chan(team));
    socket.data.room = this.code;
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
    this.pushState();
    this.pushVoicePeers(team);
    return { ok: true };
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    for (const key of Object.keys(this.engines)) this.engines[key].chefs.delete(id);
    if (this.hostId === id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
    }
    this.io.to(this.chan(p.team)).emit('voice:left', { id });
    this.pushVoicePeers(p.team);
    if (this.players.size === 0) { this.stopLoop(); this.mgr.destroy(this.code); return; }
    this.pushState();
  }

  setTeam(id, team) {
    if (this.phase !== 'lobby') return;
    const p = this.players.get(id);
    if (!p || !TEAMS.includes(team) || p.team === team) return;
    if (this.teamPlayers(team).length >= this.teamSize) return;
    const socket = this.io.sockets.sockets.get(id);
    if (socket) { socket.leave(this.chan(p.team)); socket.join(this.chan(team)); }
    const old = p.team;
    p.team = team;
    p.ready = false;
    this.io.to(this.chan(old)).emit('voice:left', { id });
    this.pushVoicePeers(old);
    this.pushVoicePeers(team);
    this.pushState();
  }

  setTeamSize(id, size) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    const s = Math.min(3, Math.max(2, size | 0));
    // Nunca se expulsa a nadie por reducir el tamano: si algun equipo ya tiene
    // mas gente de la nueva cuota, se rechaza el cambio y se avisa al host.
    const tooBig = TEAMS.find((t) => this.teamPlayers(t).length > s);
    if (tooBig) {
      this.io.to(id).emit('toast', { msg: `El ${TEAM_META[tooBig].name} ya tiene mas de ${s} jugadores`, kind: 'warn' });
      return;
    }
    this.teamSize = s;
    this.pushState();
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!ready;
    this.pushState();
  }

  setVoice(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.voice = !!on;
    this.pushState();
    if (on) this.pushVoicePeers(p.team);
  }

  pushVoicePeers(team) {
    const humans = this.teamPlayers(team).filter((p) => !p.bot);   // los bots no hablan
    for (const p of humans) {
      this.io.to(p.id).emit('voice:peers', {
        peers: humans.filter((q) => q.id !== p.id).map((q) => ({ id: q.id, name: q.name })),
      });
    }
  }

  publicState() {
    return {
      code: this.code,
      host: this.hostId,
      phase: this.phase,
      teamSize: this.teamSize,
      capacity: this.capacity,
      teamMeta: TEAM_META,
      botLevel: this.botLevel,
      botLevels: Object.keys(LEVELS).map((k) => ({ id: k, name: LEVELS[k].name })),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, team: p.team, ready: p.ready, voice: p.voice,
        bot: !!p.bot, level: p.level || null,
      })),
      countdown: this.phase === 'countdown' ? Math.ceil(this.timer) : 0,
    };
  }

  pushState() {
    this.io.to(`r:${this.code}`).emit('room:state', this.publicState());
  }

  canStart() {
    const a = this.teamPlayers('A').length;
    const b = this.teamPlayers('B').length;
    if (a === 0 || b === 0) return { ok: false, err: 'Cada equipo necesita al menos 1 jugador o bot' };
    if (!this.humans().length) return { ok: false, err: 'Hace falta al menos una persona' };
    const notReady = [...this.players.values()].filter((p) => !p.ready && p.id !== this.hostId);
    if (notReady.length) return { ok: false, err: 'Faltan jugadores por marcar "Listo"' };
    return { ok: true };
  }

  start(id) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    const chk = this.canStart();
    if (!chk.ok) { this.io.to(id).emit('toast', { msg: chk.err, kind: 'warn' }); return; }

    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.engines = {};
    for (const t of TEAMS) {
      const list = this.teamPlayers(t);
      if (list.length) this.engines[t] = new Engine(MAP, seed, list, this.teamSize);
    }

    this.phase = 'countdown';
    this.timer = COUNTDOWN_SECONDS;
    this.lastResults = null;

    this.io.to(`r:${this.code}`).emit('match:start', {
      map: { id: MAP.id, name: MAP.name, w: MAP.w, h: MAP.h, layout: MAP.layout, deco: MAP.deco },
      ingredients: INGREDIENTS,
      recipes: RECIPES,
      teamMeta: TEAM_META,
      duration: MATCH_SECONDS,
      countdown: COUNTDOWN_SECONDS,
      tick: TICK_HZ,
      roster: this.publicState().players,
    });
    this.pushState();
    this.startLoop();
  }

  startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }
  stopLoop() {
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
  }

  input(id, data) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing') return;
    const e = this.engines[p.team];
    if (e) e.setInput(id, data);
  }
  act(id) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing') return;
    const e = this.engines[p.team];
    if (e) e.requestAct(id);
  }
  dash(id) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing') return;
    const e = this.engines[p.team];
    if (e) e.requestDash(id);
  }
  throwItem(id, d) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing') return;
    const e = this.engines[p.team];
    if (e) e.requestThrow(id, (d && d.dx) || 0, (d && d.dy) || 0);
  }

  tick() {
    if (this.phase === 'countdown') {
      this.timer -= DT;
      if (this.timer <= 0) {
        this.phase = 'playing';
        this.timer = MATCH_SECONDS;
        this.pushState();
      }
      return;
    }
    if (this.phase !== 'playing') return;

    this.timer -= DT;
    const scores = {};
    const plates = {};
    for (const t of TEAMS) {
      if (!this.engines[t]) continue;
      this.engines[t].step();
      scores[t] = this.engines[t].score;
      plates[t] = this.engines[t].delivered;   // platos servidos, para el marcador cara a cara
    }

    const left = Math.max(0, this.timer);
    for (const t of TEAMS) {
      const e = this.engines[t];
      if (!e) continue;
      const snap = e.snapshot();
      snap.left = Math.round(left * 10) / 10;
      snap.scores = scores;
      snap.plates = plates;
      this.io.to(this.chan(t)).emit('state', snap);
    }

    if (this.timer <= 0) this.finish();
  }

  finish() {
    this.phase = 'results';
    this.stopLoop();
    const results = { teams: {}, winner: null };
    let best = -1;
    for (const t of TEAMS) {
      const e = this.engines[t];
      if (!e) continue;
      results.teams[t] = Object.assign({ name: TEAM_META[t].name, players: this.teamPlayers(t).map((p) => p.name) }, e.stats());
      if (e.score > best) { best = e.score; results.winner = t; }
      else if (e.score === best) results.winner = 'tie';
    }
    this.lastResults = results;
    this.io.to(`r:${this.code}`).emit('match:end', results);
    for (const p of this.players.values()) p.ready = false;
    setTimeout(() => {
      if (this.phase === 'results') { this.phase = 'lobby'; this.engines = {}; this.pushState(); }
    }, 1500);
  }
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  count() { return this.rooms.size; }
  destroy(code) { const r = this.rooms.get(code); if (r) { r.stopLoop(); this.rooms.delete(code); } }

  roomOf(socket) {
    const code = socket.data.room;
    return code ? this.rooms.get(code) : null;
  }

  attach(socket) {
    socket.data.name = 'Chef';

    socket.on('ping:cli', (d, cb) => { if (typeof cb === 'function') cb(Date.now()); });

    socket.on('hello', (d, cb) => {
      socket.data.name = sanitizeName(d && d.name);
      if (typeof cb === 'function') cb({ ok: true, id: socket.id, name: socket.data.name });
    });

    socket.on('room:create', (d, cb) => {
      if (this.roomOf(socket)) this.leave(socket);
      let code = makeCode();
      let guard = 0;
      while (this.rooms.has(code) && guard++ < 50) code = makeCode();
      const room = new Room(this, code, socket.id, (d && d.teamSize) || 2);
      this.rooms.set(code, room);
      const res = room.add(socket, (d && d.name) || socket.data.name);
      if (typeof cb === 'function') cb(Object.assign({ code }, res));
    });

    socket.on('room:join', (d, cb) => {
      const code = String((d && d.code) || '').toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) { if (typeof cb === 'function') cb({ ok: false, err: 'Sala no encontrada' }); return; }
      if (this.roomOf(socket)) this.leave(socket);
      const res = room.add(socket, (d && d.name) || socket.data.name);
      if (typeof cb === 'function') cb(Object.assign({ code }, res));
    });

    socket.on('room:leave', () => this.leave(socket));
    socket.on('room:setTeam', (d) => { const r = this.roomOf(socket); if (r) r.setTeam(socket.id, d && d.team); });
    socket.on('room:setTeamSize', (d) => { const r = this.roomOf(socket); if (r) r.setTeamSize(socket.id, d && d.size); });
    socket.on('room:addBot', (d) => { const r = this.roomOf(socket); if (r) r.addBot(socket.id, d && d.team, d && d.level); });
    socket.on('room:removeBot', (d) => { const r = this.roomOf(socket); if (r) r.removeBot(socket.id, d && d.id); });
    socket.on('room:botLevel', (d) => { const r = this.roomOf(socket); if (r) r.setBotLevel(socket.id, d && d.level); });
    socket.on('room:ready', (d) => { const r = this.roomOf(socket); if (r) r.setReady(socket.id, d && d.ready); });
    socket.on('room:start', () => { const r = this.roomOf(socket); if (r) r.start(socket.id); });

    socket.on('input', (d) => { const r = this.roomOf(socket); if (r) r.input(socket.id, d || {}); });
    socket.on('act', () => { const r = this.roomOf(socket); if (r) r.act(socket.id); });
    socket.on('dash', () => { const r = this.roomOf(socket); if (r) r.dash(socket.id); });
    socket.on('throw', (d) => { const r = this.roomOf(socket); if (r) r.throwItem(socket.id, d); });

    // ---- senalizacion WebRTC (malla por equipo) ----
    socket.on('voice:enable', (d) => { const r = this.roomOf(socket); if (r) r.setVoice(socket.id, d && d.on); });
    socket.on('voice:signal', (d) => {
      const r = this.roomOf(socket);
      if (!r || !d || !d.to) return;
      const me = r.players.get(socket.id);
      const other = r.players.get(d.to);
      if (!me || !other || me.team !== other.team) return; // solo dentro del equipo
      this.io.to(d.to).emit('voice:signal', { from: socket.id, data: d.data });
    });

    socket.on('disconnect', () => this.leave(socket));
  }

  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    socket.leave(`r:${room.code}`);
    socket.leave(room.chan('A'));
    socket.leave(room.chan('B'));
    socket.data.room = null;
    room.remove(socket.id);
    socket.emit('room:left', {});
  }
}

module.exports = { RoomManager, Room, MAP };
