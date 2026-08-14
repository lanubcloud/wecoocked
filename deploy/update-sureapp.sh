#!/usr/bin/env bash
# =============================================================================
#  Actualizar Wecoocked en un panel SureApp (suresupport).
#
#  Uso, DENTRO del shell del proyecto:
#      sureapp project shell wecoocked
#      bash deploy/update-sureapp.sh
#
#  Notas del entorno:
#   - Node solo esta en el PATH dentro de `sureapp project shell`.
#   - Dentro de ese shell, "~" apunta al home virtual del proyecto, no al real:
#     por eso aqui se usan rutas absolutas derivadas del propio script.
#   - `sureapp project` no tiene subcomando de reinicio: hay que pulsar el
#     boton del panel web (o lo que confirmemos que funcione en tu servidor).
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
echo "==> Carpeta: $APP_DIR"

# SureApp solo pone Node en el PATH dentro de `sureapp project shell`, pero el
# binario vive en una ruta fija del sistema. Buscandolo aqui, este script
# funciona igual desde el shell normal y no hace falta entrar al subshell.
if ! command -v node >/dev/null 2>&1; then
  for p in /usr/local/node/versions/lts/bin /usr/local/node/versions/*/bin; do
    if [[ -x "$p/node" ]]; then PATH="$p:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: no encuentro node. Entra con:  sureapp project shell wecoocked" >&2
  exit 1
fi
echo "==> Node $(node -v)  ($(command -v node))"

if [[ ! -d .git ]]; then
  echo "ERROR: esta carpeta no es un clon de git todavia." >&2
  exit 1
fi

ANTES="$(git rev-parse HEAD)"
echo "==> Descargando cambios"
git fetch --all --prune
git reset --hard origin/main
if [[ "$ANTES" == "$(git rev-parse HEAD)" ]]; then
  echo "    ya estabas al dia"
else
  git --no-pager log --oneline "$ANTES"..HEAD | sed 's/^/    /'
fi

# npm install, no npm ci: ci borra node_modules por completo y en paneles
# gestionados eso puede romper enlaces del entorno.
echo "==> Dependencias"
npm install --omit=dev

# Comprobacion de sintaxis sin ejecutar nada: si algo llego roto, mejor
# enterarse aqui que despues de reiniciar y dejar el juego caido.
echo "==> Verificando sintaxis"
for f in server/index.js server/rooms.js server/game/*.js; do
  node --check "$f" || { echo "ERROR de sintaxis en $f" >&2; exit 1; }
done
echo "    todos los modulos del servidor OK"

echo
# Los iconos son la causa habitual de que no salga "Instalar": si faltan o
# llegan corruptos, el navegador descarta la aplicacion sin decir nada.
echo "==> Iconos de la aplicacion"
faltan=0
for f in $(node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  console.log([...new Set(m.icons.map(i => i.src))].join(' '));
"); do
  ruta="public/$f"
  if [[ ! -f "$ruta" ]]; then
    echo "    FALTA $ruta" >&2; faltan=1
  elif [[ "$(head -c 8 "$ruta" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]]; then
    echo "    CORRUPTO $ruta (no es un PNG valido)" >&2; faltan=1
  else
    echo "    OK $ruta ($(stat -c%s "$ruta") bytes)"
  fi
done
if [[ $faltan -eq 1 ]]; then
  echo "    -> sin iconos validos el navegador NO ofrecera instalar la app." >&2
  echo "       Regenera con: node deploy/make-icons.js  y vuelve a subirlos." >&2
fi

# El service worker cachea los assets por su ?v=. Si cambio algo de public/
# pero no subio la version, los moviles seguirian con el juego viejo.
if git diff --name-only "$ANTES" HEAD | grep -q '^public/' ; then
  V_HTML="$(grep -o 'js/main.js?v=[0-9]*' public/index.html | grep -o '[0-9]*' | head -1)"
  V_SW="$(grep -o "CACHE = 'wecoocked-v[0-9]*'" public/sw.js | grep -o '[0-9]*' | head -1)"
  if [[ "$V_HTML" != "$V_SW" ]]; then
    echo "AVISO: index.html va por v=$V_HTML y sw.js por v=$V_SW. Los moviles"
    echo "       instalados podrian quedarse con la version antigua." >&2
  else
    echo "    assets en v=$V_HTML (index.html y sw.js coinciden)"
  fi
fi

# Solo el codigo de server/ necesita reinicio: lo de public/ lo sirve Express
# leyendolo del disco en cada peticion, asi que entra en vigor al recargar.
#
# Ojo con el caso "ya estabas al dia": ahi el diff sale vacio y sin este primer
# caso el script anunciaba "no hace falta reiniciar", que es justo lo contrario
# de lo que toca si vienes de un despliegue con cambios de servidor sin aplicar.
if [[ "$ANTES" == "$(git rev-parse HEAD)" ]]; then
  echo "No habia nada nuevo que desplegar. Si el despliegue anterior toco"
  echo "server/ y aun no has reiniciado desde el panel, sigue pendiente."
elif git diff --name-only "$ANTES" HEAD | grep -q '^server/'; then
  echo "Ha cambiado codigo del SERVIDOR: hay que REINICIAR desde el panel."
else
  echo "Solo han cambiado archivos del cliente: NO hace falta reiniciar,"
  echo "basta con recargar la pagina en el movil."
fi
echo
echo "Comprueba con:"
echo "    curl -s https://wecoocked.la-nub.com/healthz; echo"
