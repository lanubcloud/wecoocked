module.exports = {
  apps: [
    {
      name: 'wecoocked',
      script: 'server/index.js',
      // El estado de las salas vive en memoria: un solo proceso.
      // Para escalar a varios, haria falta un adaptador de Redis para Socket.IO.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production', PORT: 3000 },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      time: true,
    },
  ],
};
