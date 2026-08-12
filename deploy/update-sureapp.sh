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
# Solo el codigo de server/ necesita reinicio: lo de public/ lo sirve Express
# leyendolo del disco en cada peticion, asi que entra en vigor al recargar.
if git diff --name-only "$ANTES" HEAD | grep -q '^server/'; then
  echo "Ha cambiado codigo del SERVIDOR: hay que REINICIAR desde el panel."
else
  echo "Solo han cambiado archivos del cliente: NO hace falta reiniciar,"
  echo "basta con recargar la pagina en el movil."
fi
echo
echo "Comprueba con:"
echo "    curl -s https://wecoocked.la-nub.com/healthz; echo"
