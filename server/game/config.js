'use strict';

// Frecuencia de simulacion del servidor (autoritativo)
const TICK_HZ = 20;
const DT = 1 / TICK_HZ;

// Duracion de la partida
const MATCH_SECONDS = 180; // 3 minutos
const COUNTDOWN_SECONDS = 4;

const CHEF = {
  radius: 0.34,
  speed: 7.6,          // casillas / segundo
  dashSpeed: 15.5,
  dashTime: 0.16,
  dashCooldown: 0.85,
  push: 3.2,           // separacion suave entre cocineros
};

const ORDER = {
  maxActive: 4,
  firstDelay: 2.0,
  intervalMin: 9,
  intervalMax: 15,
  lifetime: 70,
  tipMax: 12,          // propina maxima por servir rapido
  expirePenalty: 8,
  wrongPenalty: 5,
};

const THROW = {
  speed: 12,          // casillas / segundo
  maxRange: 7,        // alcance maximo antes de caer al suelo
  catchRadius: 0.55,  // distancia a la que un companero lo atrapa al vuelo
  selfGrace: 1.6,     // el que lanza no puede recogerlo hasta esta distancia
  minMag: 0.6,        // fuerza minima del joystick derecho para que cuente como lanzamiento
};

const PREP = {
  // Cortar y fregar van a TOQUES, no manteniendo pulsado: se siente mas
  // fisico y da ritmo a la partida. Cada toque avanza una fraccion.
  chopTaps: 5,         // toques para cortar un ingrediente
  washTime: 1.3,       // segundos MANTENIENDO el boton para fregar un plato
  tapCooldown: 0.09,   // minimo entre toques utiles (evita el autoclicker)
  cookTime: 8.0,
  burnTime: 15.0,      // tiempo total antes de quemarse
  dirtyReturnDelay: 7, // segundos hasta que vuelve el plato sucio
};

const PLATES_START = 5;
const PLATE_CAPACITY = 4;

module.exports = {
  TICK_HZ, DT, MATCH_SECONDS, COUNTDOWN_SECONDS,
  CHEF, ORDER, PREP, THROW, PLATES_START, PLATE_CAPACITY,
};
