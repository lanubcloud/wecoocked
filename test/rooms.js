'use strict';
// Pruebas de sala sin sockets: se simula lo justo de socket.io.
const path = require('path');
const ROOT = path.join(__dirname, '..');

const emitidos = [];
const io = {
  to: () => ({ emit: (ev, d) => emitidos.push({ ev, d }) }),
  sockets: { sockets: new Map() },
};

const { RoomManager } = require(path.join(ROOT, 'server/rooms.js'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const mgr = new RoomManager(io);
const socket = { id: 'humano', data: {}, join() {}, leave() {}, on() {} };
mgr.attach(socket);

let code = null;
socket.emit = () => {};
mgr.rooms.set('TEST', new (require(path.join(ROOT, 'server/rooms.js')).Room)(mgr, 'TEST', 'humano', 2));
const room = mgr.rooms.get('TEST');
room.add(socket, 'Yo');
room.addBot('humano', 'A');
room.addBot('humano', 'B');

ok(room.canStart().ok, 'con un humano y dos bots se puede empezar: ' + JSON.stringify(room.canStart()));

// simulamos una partida completa
room.start('humano');
ok(room.phase === 'countdown', 'la partida arranca');
room.timer = 0.01; room.tick();          // termina la cuenta atras
ok(room.phase === 'playing', 'pasa a jugando');
room.timer = 0.01; room.tick();          // agota el tiempo
ok(room.phase === 'results', 'termina y muestra resultados');

const botsListos = [...room.players.values()].filter((p) => p.bot).every((p) => p.ready);
ok(botsListos, 'los bots siguen listos despues de la partida');

room.phase = 'lobby';
ok(room.canStart().ok, 'se puede empezar una SEGUNDA partida: ' + JSON.stringify(room.canStart()));

room.stopLoop();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
