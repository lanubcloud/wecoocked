#!/usr/bin/env bash
# =============================================================================
#  Actualizar Wecoocked en un cPanel con "Setup Node.js App" (Passenger).
#
#  Uso desde SSH, dentro de la carpeta de la aplicacion:
#      bash deploy/update-cpanel.sh
#
#  Diferencias importantes frente a un VPS pelado:
#   - NO se usa `npm ci`: borra node_modules, que en cPanel es un enlace
#     simbolico al entorno virtual de Node. Se usa `npm install`.
#   - NO hay systemd: Passenger recarga la app al tocar tmp/restart.txt.
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Carpeta de la aplicacion: $APP_DIR"

if [[ -d .git ]]; then
  echo "==> Descargando cambios de GitHub"
  git fetch --all --prune
  git reset --hard origin/main
else
  echo "==> Sin repositorio git aqui: se actualizan solo las dependencias"
fi

echo "==> Dependencias"
if [[ -z "${VIRTUAL_ENV:-}" ]]; then
  echo "    AVISO: no estas dentro del entorno virtual de Node de cPanel."
  echo "    Copia el comando 'source .../bin/activate' que muestra la pagina"
  echo "    de tu aplicacion en cPanel, ejecutalo y vuelve a lanzar este script."
fi
npm install --omit=dev

echo "==> Reiniciando la aplicacion (Passenger)"
mkdir -p tmp
touch tmp/restart.txt

echo
echo "Listo. Passenger recargara la app en la siguiente peticion."
echo "Comprueba con:  curl -s https://TU_SUBDOMINIO/healthz"
