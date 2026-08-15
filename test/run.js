'use strict';
// Lanza todas las suites y devuelve codigo != 0 si alguna falla.
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['engine.js', 'throw.js', 'bots.js', 'rooms.js', 'assets.js', 'contrato-mapa.js'];
let failed = 0;

for (const s of suites) {
  console.log(`\n===== ${s} ${'='.repeat(Math.max(0, 60 - s.length))}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} suite(s) con fallos` : '\nTodas las suites OK');
process.exit(failed ? 1 : 0);
