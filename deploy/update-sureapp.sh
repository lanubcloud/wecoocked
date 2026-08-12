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

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node no esta en el PATH." >&2
  echo "       Entra antes con:  sureapp project shell wecoocked" >&2
  exit 1
fi
echo "==> Node $(node -v)"

if [[ ! -d .git ]]; then
  echo "ERROR: esta carpeta no es un clon de git todavia." >&2
  exit 1
fi

echo "==> Descargando cambios"
git fetch --all --prune
git reset --hard origin/main

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
echo "Codigo actualizado. Ahora REINICIA la aplicacion desde el panel web"
echo "y comprueba con:"
echo "    curl -s https://\$TU_SUBDOMINIO/healthz; echo"
