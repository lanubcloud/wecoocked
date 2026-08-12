#!/usr/bin/env bash
# =============================================================================
#  Wecoocked - provision inicial del VPS (Ubuntu/Debian). Se ejecuta UNA vez.
#
#  Uso, como root o con sudo:
#     sudo bash setup-vps.sh tu-dominio.com tu-email@ejemplo.com https://github.com/USUARIO/wecoocked.git
# =============================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${3:-}"
APP_DIR="/var/www/wecoocked"
APP_USER="wecoocked"

if [[ -z "$DOMAIN" || -z "$EMAIL" || -z "$REPO" ]]; then
  echo "Uso: sudo bash setup-vps.sh <dominio> <email> <url-repo-git>" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Ejecutalo como root o con sudo." >&2
  exit 1
fi

echo "==> 1/7 Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ufw ca-certificates

echo "==> 2/7 Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2-3)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> 3/7 Usuario de servicio y codigo"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
else
  git clone "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR && npm ci --omit=dev"

echo "==> 4/7 Servicio systemd"
cat >/etc/systemd/system/wecoocked.service <<EOF
[Unit]
Description=Wecoocked - juego multijugador de cocina
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
# El estado de las salas vive en memoria: un unico proceso.
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now wecoocked

echo "==> 5/7 Nginx"
sed "s/tu-dominio.com/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" >/etc/nginx/sites-available/wecoocked
ln -sf /etc/nginx/sites-available/wecoocked /etc/nginx/sites-enabled/wecoocked
rm -f /etc/nginx/sites-enabled/default
# Antes de tener certificado, servimos solo por HTTP para que certbot pueda validar
cat >/etc/nginx/sites-available/wecoocked-bootstrap <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1;
                 proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade";
                 proxy_set_header Host \$host; }
}
EOF
rm -f /etc/nginx/sites-enabled/wecoocked
ln -sf /etc/nginx/sites-available/wecoocked-bootstrap /etc/nginx/sites-enabled/wecoocked-bootstrap
nginx -t && systemctl reload nginx

echo "==> 6/7 HTTPS con Let's Encrypt (obligatorio para el chat de voz)"
apt-get install -y -qq certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
systemctl reload nginx

echo "==> 7/7 Cortafuegos"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

# Permitir que el deploy automatico reinicie el servicio sin contrasena
cat >/etc/sudoers.d/wecoocked <<EOF
$APP_USER ALL=(root) NOPASSWD: /bin/systemctl restart wecoocked, /bin/systemctl status wecoocked
EOF
chmod 440 /etc/sudoers.d/wecoocked

echo
echo "======================================================================"
echo " Listo. El juego esta en:  https://$DOMAIN"
echo " Estado del servicio:      systemctl status wecoocked"
echo " Logs en vivo:             journalctl -u wecoocked -f"
echo "======================================================================"
