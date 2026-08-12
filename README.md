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

Abre `http://localhost:3000` en dos pestañas para probarlo tú solo.

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

```bash
git clone <tu-repo> /var/www/wecoocked && cd /var/www/wecoocked
npm ci --omit=dev
npm install -g pm2
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

Después Nginx como proxy inverso con HTTPS (ver `deploy/nginx.conf`) y:

```bash
sudo certbot --nginx -d tu-dominio.com
```

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
cocción/corte/fregado, frecuencia y caducidad de los pedidos, penalizaciones.
Las recetas están en `server/game/recipes.js` y el mapa en `server/game/map.js`
(basta con editar la cuadrícula `LAYOUT`, todo lo demás se deriva de ella).
