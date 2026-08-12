'use strict';

/*
 Mapa "Negi Sushi" (replica jugable del pantallazo de referencia).

 #  muro / decorado         .  suelo
 C  encimera                B  tabla de cortar
 K  olla arrocera           D  pila de platos limpios
 W  fregadero               X  devolucion de platos sucios
 T  basura                  V  ventanilla de entrega
 N/R/P/G/S  cajas de nori / arroz / pepino / gamba / salmon
*/
const LAYOUT = [
  '######################',
  '#....................#',
  '#N..CCBBCC...CKKKKC..#',
  '#R.......C...C.......V',
  '#P.......C...C.......V',
  '#G.......C...C.......V',
  '#S.......C...C.......#',
  '#D.......C...C.......#',
  '#C.......C...C..CCCC.#',
  '#C...........C.......#',
  '#..CCTC.....CWWX.....#',
  '#....................#',
  '######################',
];

const LEGEND = {
  '#': { type: 'wall',    solid: true,  interactive: false },
  '.': { type: 'floor',   solid: false, interactive: false },
  'C': { type: 'counter', solid: true,  interactive: true },
  'B': { type: 'board',   solid: true,  interactive: true },
  'K': { type: 'cooker',  solid: true,  interactive: true },
  'D': { type: 'plates',  solid: true,  interactive: true },
  'W': { type: 'sink',    solid: true,  interactive: true },
  'X': { type: 'return',  solid: true,  interactive: true },
  'T': { type: 'trash',   solid: true,  interactive: true },
  'V': { type: 'serve',   solid: true,  interactive: true },
  'N': { type: 'crate',   solid: true,  interactive: true, ing: 'nori' },
  'R': { type: 'crate',   solid: true,  interactive: true, ing: 'rice' },
  'P': { type: 'crate',   solid: true,  interactive: true, ing: 'cucumber' },
  'G': { type: 'crate',   solid: true,  interactive: true, ing: 'shrimp' },
  'S': { type: 'crate',   solid: true,  interactive: true, ing: 'salmon' },
};

function buildMap() {
  const h = LAYOUT.length;
  const w = LAYOUT[0].length;
  LAYOUT.forEach((row, y) => {
    if (row.length !== w) throw new Error(`Fila ${y} del mapa mide ${row.length}, se esperaban ${w}`);
  });

  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = LAYOUT[y][x];
      const def = LEGEND[ch];
      if (!def) throw new Error(`Simbolo desconocido "${ch}" en (${x},${y})`);
      cells.push({ x, y, ch, type: def.type, solid: def.solid, interactive: def.interactive, ing: def.ing || null });
    }
  }

  return {
    id: 'negi_sushi',
    name: 'Negi Sushi',
    w, h, cells,
    layout: LAYOUT,
    spawns: [
      { x: 3.5, y: 11.5 },
      { x: 6.5, y: 11.5 },
      { x: 9.5, y: 11.5 },
    ],
    // Decorados puramente visuales (el cliente los pinta encima de los muros)
    deco: [
      { type: 'sign', text: 'NEGI SUSHI', x: 13.2, y: 0.08, w: 5.6, h: 0.85 },
      { type: 'sakura', x: 0.5, y: 11.5, r: 0.9 },
      { type: 'lantern', x: 0.5, y: 1.5 },
      { type: 'lantern', x: 21.5, y: 8.5 },
      { type: 'rug', x: 10.0, y: 1.0, w: 2, h: 1 },
    ],
  };
}

module.exports = { buildMap, LAYOUT, LEGEND };
