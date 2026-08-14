'use strict';

/*
 Mapa "Negi Sushi" (replica jugable del pantallazo de referencia).

 #  muro / decorado         .  suelo
 -  borde invisible: frena al cocinero pero no se dibuja nada. Sirve para
    cerrar la cocina por arriba y por abajo sin gastar una fila en pintar
    una pared, y asi queda mas sitio util en pantalla.
 C  encimera                B  tabla de cortar
 K  olla arrocera           D  pila de platos limpios
 W  fregadero               X  devolucion de platos sucios
 T  basura                  V  ventanilla de entrega
 N/R/P/G/S  cajas de nori / arroz / pepino / gamba / salmon
*/
/*
 Cocina 18x11, con la distribucion del mapa de referencia: tablas de cortar
 arriba a la izquierda, arroceras bajo el cartel de neon, entrega a la
 derecha, cajas de ingredientes en la columna izquierda, isla central
 alargada y fregadero abajo. En un movil apaisado entra entera con casillas
 de ~43 px: punto medio entre la 22x13 original (casillas diminutas) y la
 14x9 (objetos enormes y apretados). Sin pasillos de una sola casilla donde
 dos cocineros pudieran quedarse trabados.
*/
/*
 Distribucion segun el plano de referencia:
   arriba  -> 2 mesas de picar con una encimera en medio, el cartel de neon,
              y las 4 cocinas con una encimera a cada lado
   izquierda -> alimentos 1-3 alternados con encimeras
   derecha -> las 3 ventanillas de entrega arriba y los alimentos 4-5 debajo
   centro  -> dos islas de 4 encimeras
   abajo   -> 2 mesas de picar, 2 basuras, platos limpios, 2 lavaplatos y
              la devolucion de sucios
*/
/*
 La fila 0 lleva las cocinas en el centro y borde invisible a los lados: en
 esas esquinas van los pedidos (izquierda) y el marcador (derecha), tal como
 en el plano. La fila 1 se deja libre para que el HUD pueda asomar sin tapar
 ninguna estacion.
*/
const LAYOUT = [
  '#-------CKKKKC---#',
  '#................#',
  '#C..............V#',
  '#N..............V#',
  '#C..CCCC..CCCC..V#',
  '#R..............G#',
  '#C..............C#',
  '#P..............S#',
  '#................#',
  '#................#',
  '#--BCB--T-T-DWWX-#',
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
    spawns: [
      { x: 4.5, y: 8.5 },
      { x: 8.5, y: 8.5 },
      { x: 12.5, y: 8.5 },
    ],
    // Decorados puramente visuales (el cliente los pinta encima de los muros)
    deco: [
      { type: 'sign', text: 'NEGI SUSHI', x: 2.9, y: 0.06, w: 4.6, h: 0.86 },
      { type: 'lantern', x: 0.5, y: 3.5 },
      { type: 'lantern', x: 17.5, y: 6.5 },
    ],
  };
}

module.exports = { buildMap, LAYOUT, LEGEND };
