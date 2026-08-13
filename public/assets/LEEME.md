# Cambiar el arte del juego sin tocar código

Todo el arte del juego está dibujado con código, pero puedes sustituir las
piezas que quieras por imágenes tuyas. Basta con dejar los PNG en esta carpeta
y crear un archivo `sprites.json` al lado.

**Si `sprites.json` no existe, no pasa nada**: el juego usa su arte dibujado.
Y si una imagen concreta falla al cargar, solo esa vuelve al dibujo por
defecto. El juego nunca se rompe por un archivo de arte que falte.

## Cómo se activa

1. Copia tus PNG a `public/assets/`
2. Crea `public/assets/sprites.json` (mira `sprites.example.json`)
3. Sube el `?v=` en `public/index.html` y en `public/sw.js`, o el móvil
   seguirá con las imágenes viejas en caché
4. Despliega

## Formato

```json
{
  "floor":   "assets/suelo.png",
  "wall":    "assets/pared.png",
  "counter": "assets/encimera.png",
  "chef": {
    "abajo":  "assets/chef-frente.png",
    "lado":   "assets/chef-lado.png",
    "arriba": "assets/chef-espalda.png"
  },
  "ingredientes": {
    "salmon:raw":     "assets/salmon.png",
    "salmon:chopped": "assets/salmon-cortado.png",
    "rice:cooked":    "assets/arroz.png"
  }
}
```

Todas las claves son opcionales: pon solo las que quieras cambiar.

| Clave | Qué sustituye | Tamaño recomendado |
|---|---|---|
| `floor` | La baldosa del suelo (se repite en cada casilla) | 128×92 px |
| `wall` | Los muros del perímetro | 128×160 px |
| `counter` | Las encimeras | 128×160 px |
| `chef.abajo` / `.lado` / `.arriba` | El avatar según hacia dónde mira | 128×200 px, fondo transparente |
| `ingredientes["tipo:estado"]` | Un ingrediente concreto | 96×96 px, fondo transparente |

**Ingredientes disponibles:** `nori`, `rice`, `cucumber`, `shrimp`, `salmon`.
**Estados:** `raw` (crudo), `chopped` (cortado), `cooked` (cocido), `burnt` (quemado).
Si pones solo `"salmon"` sin estado, se usa esa imagen para todos sus estados.

### Sobre los avatares

- Fondo **transparente** y el personaje mirando al frente, de cuerpo entero.
- Los pies deben quedar en el **borde inferior** de la imagen: el juego apoya
  el sprite en el suelo por ahí.
- El juego pinta una elipse del color del equipo bajo los pies, así que no
  necesitas una versión por equipo.
- `lado` se usa para izquierda y derecha: el juego lo espeja solo. Dibújalo
  mirando a la **derecha**.

## De dónde sacar arte

Estas fuentes permiten uso comercial. **Revisa siempre la licencia concreta de
cada pieza**, porque dentro de un mismo sitio varía:

| Sitio | Qué tiene | Licencia habitual |
|---|---|---|
| [Kenney.nl](https://kenney.nl/assets) | Packs de personajes y objetos de juego, muy pulidos | CC0 (uso libre, sin atribución) |
| [OpenGameArt.org](https://opengameart.org) | Enorme variedad, calidad desigual | CC0 / CC-BY según pieza |
| [itch.io/game-assets](https://itch.io/game-assets/free) | Packs gratuitos y de pago, mucho estilo *cozy* | Varía por autor |
| [Game-icons.net](https://game-icons.net) | Iconos vectoriales de comida y utensilios | CC-BY |
| [Craftpix.net](https://craftpix.net/freebies/) | Packs 2D temáticos, algunos de cocina | Varía |

**Lo que no puedes usar:** sprites extraídos de Overcooked o de cualquier
juego comercial. Están protegidos por copyright aunque los encuentres subidos
por ahí.

### Si quieres encargarlos o generarlos

- **Encargar**: en Fiverr o Upwork, buscando *"2D top-down game sprites"*.
  Pide explícitamente perspectiva **3/4 cenital** para que encaje.
- **Generar con IA**: Midjourney, DALL·E o Stable Diffusion sirven, pidiendo
  *"top-down 3/4 view game sprite, transparent background, cartoon style"*.
  Tendrás que recortar el fondo tú (remove.bg o Photopea, ambos gratuitos).

Lo importante en los dos casos: **perspectiva 3/4 cenital y fondo
transparente**. Si el arte es de frente puro o en isométrico, no encajará con
la cocina.
