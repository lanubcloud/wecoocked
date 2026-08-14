'use strict';

/*
 Mapa "Negi Sushi", calcado del plano de referencia (17 columnas x 9 filas).

 #  pared azul               .  suelo
 -  borde invisible: frena al cocinero pero no se dibuja nada. Va donde el
    plano no pinta pared: la fila de arriba (que ocupan los pedidos, el cartel
    y el marcador) y las esquinas de abajo, que es donde caen los joysticks.
 C  encimera                 B  tabla de cortar
 K  cocina                   D  pila de platos limpios
 W  lavaplatos               X  devolucion de platos sucios
 T  basura                   V  ventanilla de entrega
 R/G/N/S/P  cajas de arroz / gamba / nori / pescado / pepino
*/
/*
 Lectura del plano, columna a columna:

  fila 0  los pedidos ocupan de la 0 a la 4, el cartel de la 5 a la 8, y la
          cocina va corrida a la derecha (encimera, 4 fuegos, encimera) para
          quedar pegada al marcador, que se queda con las columnas 15-16.
  izq.    columna 1: arroz, encimera, gamba, encimera, nori. Termina en la
          fila 5 a proposito: mas abajo esta el joystick y se tapaban.
  der.    columna 15: las dos ventanillas de entrega arriba y luego pescado,
          encimera y pepino, tambien parando en la fila 5.
  centro  dos islas de 4 encimeras en la fila 4.
  abajo   fila 8, 13 estaciones entre las columnas 2 y 14: las esquinas se
          dejan libres para los joysticks.

 El plano marca el circulo del centro como platos. Como el juego necesita dos
 sitios distintos (de donde coges limpios y donde vuelven los sucios), la
 devolucion se queda en el centro y una de las dos basuras pasa a ser la pila
 de platos limpios. Es el unico punto donde no se puede copiar el plano tal
 cual; el resto esta calcado.
*/
const LAYOUT = [
  '---------CKKKKC--',
  '#R.............V#',
  '#C.............V#',
  '#G.............S#',
  '#C..CCCC.CCCC..C#',
  '#N.............P#',
  '-...............-',
  '-...............-',
  '--BCBCTWXWDCBCB--',
];

const LEGEND = {
  '#': { type: 'wall',    solid: true,  interactive: false },
  '-': { type: 'edge',    solid: true,  interactive: false },
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
    // En las filas 6 y 7, que es la franja despejada del plano
    spawns: [
      { x: 4.5, y: 6.5 },
      { x: 8.5, y: 6.5 },
      { x: 12.5, y: 6.5 },
    ],
    // Decorados puramente visuales (el cliente los pinta encima de los muros).
    // El cartel ocupa de la columna 5 a la 8: los pedidos se cortan justo
    // antes para no montarse encima, que es lo que pasaba antes.
    deco: [
      { type: 'sign', text: 'NEGI SUSHI', x: 4.95, y: 0.06, w: 4.1, h: 0.86 },
      { type: 'lantern', x: 0.5, y: 3.5 },
      { type: 'lantern', x: 16.5, y: 3.5 },
    ],
  };
}

module.exports = { buildMap, LAYOUT, LEGEND };
