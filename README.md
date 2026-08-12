# Wecoocked — Sushi Rush

Juego multijugador tipo *Overcooked* para **móvil en horizontal**. Varias personas entran
a una sala, se reparten en **Equipo Rojo** y **Equipo Azul** (2 o 3 por equipo) y compiten
**3 minutos** por servir más platos de sushi. Cada equipo tiene su propio **chat de voz**.

- Servidor **autoritativo** en Node.js (20 ticks/s) — imposible hacer trampas desde el cliente.
- Ambos equipos reciben **exactamente los mismos pedidos** (misma semilla de aleatoriedad).
- Cliente web puro: sin instalación, sin tienda de apps. Se abre una URL y a jugar.

---

## Arranque rápido

```bash
npm install
npm start
```

Abre `http://localhost:3000`, crea una sala y pulsa **+ Bot** para rellenar los equipos:
puedes jugar solo contra bots sin esperar a nadie.

```bash
npm test
```

---

## Bots

Cualquier hueco de cualquier equipo se puede rellenar con un bot desde el lobby
(botón **+ Bot**, y la **×** para quitarlo). Sirven tanto para jugar solo contra la
máquina como para completar un equipo al que le falta gente.

Ejemplos que se montan en dos toques:

- **Tú solo contra un bot** — 1 por equipo.
- **Tú + un bot compañero contra 2 bots** — el caso típico para practicar.
- **Tu equipo de 3 personas contra 3 bots.**

### Niveles

| Nivel | Velocidad | Reflejos | Rinde (bot solo, media de 10 partidas) |
|---|---|---|---|
| Fácil | 70 % | lentos, se despista | 1,6 platos |
| Normal | 88 % | normales | 2,8 platos |
| Difícil | 100 % | inmediatos | 3,2 platos |

En equipo, los bots difíciles rinden 3,3 → 5,7 → 6,7 platos según sean 1, 2 o 3.
Ese ~6,7 es el listón a batir.

Los bots llevan algo de aleatoriedad en los reflejos y en qué pedido eligen. Sin ella,
dos equipos del mismo nivel harían exactamente lo mismo y siempre empatarían; con ella,
las 8 partidas de prueba entre bots idénticos terminaron con ganador.

Los bots juegan **con las mismas reglas que tú**: mueven el mismo joystick virtual y
pulsan los mismos botones a través de la misma API del servidor. No hacen trampa ni
tienen atajos. Cada bot se encarga de un pedido completo de principio a fin y reserva
la olla, la tabla y la encimera que necesita para no pisarse con sus compañeros.

---

## Marcador cara a cara

Durante toda la partida, cada jugador ve en su pantalla:

```
Equipo Rojo   🍣 3   52      <- tu equipo: platos servidos y puntos
Equipo Azul   🍣 5  113      <- el rival, en tiempo real
              -2 platos      <- diferencia, en verde o rojo
```

Así sabes en cada momento si vas ganando sin tener que preguntar.

---

## Controles (móvil, horizontal)

| Control | Acción |
|---|---|
| **Joystick izquierdo** (flotante, mitad izquierda) | Mover al cocinero |
| **Joystick derecho** (flotante, mitad derecha) | Apuntar y **lanzar ingredientes** al soltar |
| **Botón A** (amarillo) | Coger, soltar, emplatar, servir, recoger del suelo |
| **Botón B** (azul, mantener) | Cortar en la tabla / fregar en el fregadero |
| **DASH** (morado) | Impulso rápido |
| **MIC** (izquierda) | Silenciar / hablar (o pulsar‑para‑hablar) |
| **II** (arriba derecha) | Pausa y opciones |

Los joysticks son **flotantes**: aparecen donde pongas el pulgar, no en una posición fija.

En escritorio: `WASD`/flechas mover, `Espacio` = A, `E` = B, `Shift` = dash, `Q` = lanzar.

### Lanzar ingredientes

Con un ingrediente en la mano, empuja el **joystick derecho**: aparece una línea de
puntería con el punto de caída. Al **soltar** sale volando. Es la jugada clave para
coordinarse: uno corta en la isla central y le lanza el pescado al compañero que está
emplatando al otro lado de la cocina, sin dar la vuelta entera.

- Un compañero **con las manos libres lo atrapa al vuelo**.
- Si choca contra una **encimera o tabla libre**, se queda encima.
- Si no, **cae al suelo** y hay que recogerlo con **A** (no se pierde nunca).
- Alcance de 7 casillas. **Los platos no se lanzan** — se romperían las entregas.
- Empujar el joystick suavemente solo apunta; hace falta un gesto firme (más del 60 %
  del recorrido) para que cuente como lanzamiento. En Pausa se puede desactivar.

---

## Cómo se juega

El mapa **Negi Sushi** replica el del juego de referencia:

```
######################
#....................#
#N..CCBBCC...CKKKKC..#     N nori    R arroz   P pepino
#R.......C...C.......V     G gamba   S salmón
#P.......C...C.......V     B tabla de cortar
#G.......C...C.......V     K arrocera
#S.......C...C.......#     D pila de platos
#D.......C...C.......#     W fregadero
#C.......C...C..CCCC.#     X devolución de platos sucios
#C...........C.......#     T basura
#..CCTC.....CWWX.....#     V ventanilla de entrega
#....................#     C encimera
######################
```

Flujo de un plato:

1. Coge **arroz** de la caja y ponlo en una **arrocera** (K). Tarda 8 s.
   A los 15 s **se quema** y hay que tirarlo a la basura.
2. Coge **gamba / salmón / pepino**, ponlo en una **tabla** (B) y mantén **B** para cortarlo.
   El **nori** no necesita preparación.
3. Coge un **plato** limpio (D) y añade los ingredientes ya preparados.
4. Llévalo a la **ventanilla** (V) de la derecha.
5. El plato vuelve sucio a la **devolución** (X) a los 7 s: recógelo, déjalo en el
   **fregadero** (W) y mantén **B** para fregarlo. Solo hay 5 platos.

**Recetas:** nigiri de gamba, nigiri de salmón, maki de pepino, maki de salmón.

Los pasos 1‑3 se pueden repartir entre el equipo y pasarse los ingredientes lanzándolos
(ver *Lanzar ingredientes*), que es donde el chat de voz marca la diferencia.

**Puntuación:** valor de la receta + propina por rapidez (hasta 12) + bonus por racha
(hasta 20). Pedido caducado −8, plato erróneo −5 y la racha se rompe.

**Carga de pedidos:** se ajusta al tamaño de equipo (3 pedidos a la vez para 1 cocinero,
4 para 2, 5 para 3) para que el tercer jugador tenga trabajo real. Las dos cocinas
reciben siempre la misma carga, así que la comparación es justa.

---

## Chat de voz

Malla **WebRTC** entre los miembros del mismo equipo (2‑3 personas), con señalización
por Socket.IO. El servidor **solo reenvía la señalización**: el audio va directo entre
móviles, así que no consume ancho de banda del VPS.

Requisitos:

- **HTTPS obligatorio.** Sin él, `getUserMedia` no funciona fuera de `localhost`.
- Si algún jugador se queda sin audio (redes móviles con NAT simétrico), añade un
  servidor **TURN** en `public/js/voice.js` → constante `ICE`.

---

## Despliegue en el VPS

### Paso 1 — Subir el código a GitHub (desde tu PC, una vez)

```bash
git remote add origin https://github.com/TU_USUARIO/wecoocked.git
```

```bash
git push -u origin main
```

### Paso 2 — Provisionar el VPS (una sola vez)

Conéctate por SSH a tu servidor y ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/TU_USUARIO/wecoocked/main/deploy/setup-vps.sh -o setup-vps.sh
```

```bash
sudo bash setup-vps.sh TU_DOMINIO.com TU_EMAIL https://github.com/TU_USUARIO/wecoocked.git
```

El script deja todo listo: Node 20, usuario de servicio, `systemd`, Nginx como proxy
inverso, certificado HTTPS con Let's Encrypt (**imprescindible para el chat de voz**)
y el cortafuegos. Al terminar el juego está en `https://TU_DOMINIO.com`.

### Paso 3 — Despliegue automático desde GitHub

En **Settings → Secrets and variables → Actions** del repositorio, añade:

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP o dominio del servidor |
| `VPS_USER` | usuario SSH (p. ej. `root` o el tuyo) |
| `VPS_SSH_KEY` | tu clave SSH **privada** completa |
| `VPS_PORT` | opcional, si no usas el 22 |

A partir de ahí, cada `git push` a `main` ejecuta las pruebas y, si pasan, actualiza el
VPS solo ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

> La clave privada la añades tú directamente en GitHub: no la compartas por chat ni la
> guardes en el repositorio.

### Operación diaria

| Para... | Comando en el VPS |
|---|---|
| Ver el estado | `systemctl status wecoocked` |
| Ver los logs en vivo | `journalctl -u wecoocked -f` |
| Reiniciar | `sudo systemctl restart wecoocked` |
| Actualizar a mano | `cd /var/www/wecoocked && bash deploy/update.sh` |
| Comprobar salud | `curl localhost:3000/healthz` |

El servidor también puede servir HTTPS por sí mismo si prefieres saltarte Nginx:

```bash
SSL_CERT=/ruta/fullchain.pem SSL_KEY=/ruta/privkey.pem PORT=443 npm start
```

**Importante al actualizar:** sube el `?v=` de las etiquetas `<script>` y `<link>` en
`public/index.html`. Sin eso los móviles se quedan con la versión cacheada.

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto de escucha |
| `HOST` | `0.0.0.0` | Interfaz |
| `NODE_ENV` | — | `production` activa caché de estáticos |
| `SSL_CERT` / `SSL_KEY` | — | HTTPS directo sin Nginx |
| `CORS_ORIGIN` | `*` | Restringir origen de Socket.IO |

### Consumo

Cada equipo son ~230 bytes por tick a 20 Hz ≈ **5 KB/s por jugador**. Una sala de 6
jugadores ronda los 30 KB/s. Un VPS de 1 vCPU aguanta decenas de salas simultáneas;
el audio no pasa por el servidor.

---

## Estructura

```
server/
  index.js            Express + Socket.IO + HTTPS opcional
  rooms.js            Salas, equipos, ciclo de partida, señalización de voz
  game/
    config.js         Constantes de ritmo, equilibrio y lanzamiento
    map.js            Mapa Negi Sushi
    recipes.js        Ingredientes y recetas
    engine.js         Simulación autoritativa (una por equipo)
    bot.js            IA de los bots: rutas, planes y niveles
test/               Pruebas del motor, del lanzamiento y de los bots
deploy/             setup-vps.sh, update.sh y nginx.conf
public/
  index.html
  css/style.css
  js/
    net.js            Socket.IO + buffer de snapshots
    input.js          Dos joysticks flotantes + botones
    voice.js          Malla WebRTC por equipo
    render.js         Renderizado en canvas
    ui.js             Pantallas, lobby, HUD
    main.js           Bucle, predicción local, interpolación
```

### Equilibrio del juego

Todo el ritmo está en `server/game/config.js`: duración, velocidad, tiempos de
cocción/corte/fregado, frecuencia y caducidad de los pedidos, penalizaciones y
alcance de los lanzamientos. Los niveles de los bots están en `server/game/bot.js`
(constante `LEVELS`).
Las recetas están en `server/game/recipes.js` y el mapa en `server/game/map.js`
(basta con editar la cuadrícula `LAYOUT`, todo lo demás se deriva de ella).
