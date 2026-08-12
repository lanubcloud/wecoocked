#!/usr/bin/env bash
# Actualiza Wecoocked en el VPS a la ultima version de main y reinicia.
# Lo usa GitHub Actions, pero tambien sirve a mano:  bash deploy/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/wecoocked}"
cd "$APP_DIR"

echo "==> Descargando cambios"
git fetch --all --prune
git reset --hard origin/main

echo "==> Dependencias"
npm ci --omit=dev

echo "==> Reiniciando servicio"
sudo systemctl restart wecoocked
sleep 2
systemctl is-active --quiet wecoocked && echo "OK: wecoocked activo" || { echo "ERROR: el servicio no arranco"; journalctl -u wecoocked -n 40 --no-pager; exit 1; }

echo "==> Comprobacion de salud"
curl -fsS http://127.0.0.1:3000/healthz && echo
