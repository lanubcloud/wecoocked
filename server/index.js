'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
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

server.listen(PORT, HOST, () => {
  console.log(`[wecoocked] escuchando en ${HOST}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[wecoocked] ${sig}, cerrando`); server.close(() => process.exit(0)); });
}
