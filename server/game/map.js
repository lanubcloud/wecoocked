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
/*
 Cocina compacta: 14x9. El tamano importa. Con el mapa antiguo (22x13) era
 imposible ver toda la cocina y a la vez tener casillas grandes en un movil:
 no cabian. Al reducirla, todo entra en pantalla con casillas mas del doble
 de grandes, se corre menos y hay mas roce entre companeros, que es de donde
 sale la gracia del juego.
*/
const LAYOUT = [
  '##############',
  '##BBKKKCC...C#',
  '#N..........V#',
  '#R..........V#',
  '#P..CCCC....V#',
  '#G..........C#',
  '#S..........C#',
  '##WWXTD.....C#',
  '##############',
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
      { x: 2.5, y: 5.5 },
      { x: 5.5, y: 5.5 },
      { x: 9.5, y: 5.5 },
    ],
    // Decorados puramente visuales (el cliente los pinta encima de los muros)
    deco: [
      { type: 'sign', text: 'NEGI SUSHI', x: 3.6, y: 0.06, w: 3.5, h: 0.86 },
      { type: 'lantern', x: 0.5, y: 4.5 },
      { type: 'lantern', x: 13.5, y: 6.5 },
      { type: 'rug', x: 9.0, y: 2.0, w: 2, h: 3 },
    ],
  };
}

module.exports = { buildMap, LAYOUT, LEGEND };
