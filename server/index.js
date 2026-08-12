'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

// Bajo Passenger (cPanel/Plesk) el "puerto" que llega en PORT puede ser la ruta
// de un socket Unix, no un numero. Por eso HOST solo se aplica si lo pides
// explicitamente: si no, se deja que Node/Passenger decidan donde escuchar.
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || null;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

let manager = null;
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: manager ? manager.count() : 0, uptime: process.uptime() }));

let server;
if (process.env.SSL_CERT && process.env.SSL_KEY) {
  const https = require('https');
  server = https.createServer(
    { cert: fs.readFileSync(process.env.SSL_CERT), key: fs.readFileSync(process.env.SSL_KEY) },
    app
  );
  console.log('[wecoocked] HTTPS activado');
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

manager = new RoomManager(io);
io.on('connection', (socket) => manager.attach(socket));

const onReady = () => console.log(`[wecoocked] escuchando en ${HOST ? HOST + ':' : ''}${PORT}`);
if (HOST) server.listen(PORT, HOST, onReady);
else server.listen(PORT, onReady);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[wecoocked] ${sig}, cerrando`); server.close(() => process.exit(0)); });
}
