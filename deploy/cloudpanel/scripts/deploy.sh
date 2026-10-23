#!/usr/bin/env bash
# Actualiza código, rebuild frontend y reinicia el API.
# Ejecutar como SITEUSER:
#   export APP_ROOT=$HOME/apps/facutools
#   export WEB_ROOT=$HOME/htdocs/tudominio.com
#   bash deploy/cloudpanel/scripts/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

APP_ROOT="${APP_ROOT:-$HOME/apps/facutools}"
WEB_ROOT="${WEB_ROOT:-}"

if [[ -z "${WEB_ROOT}" ]]; then
  echo "Error: definí WEB_ROOT"
  exit 1
fi

cd "${REPO_ROOT}"
echo "==> git pull"
git pull --ff-only

echo "==> Dependencias Python"
# shellcheck disable=SC1091
source "${APP_ROOT}/venv/bin/activate"
pip install -r "${REPO_ROOT}/backend/requirements.txt"

echo "==> Frontend build"
cd "${REPO_ROOT}/frontend"
npm install
npm run build

echo "==> Publicar estáticos"
rsync -a --delete "${REPO_ROOT}/frontend/dist/" "${WEB_ROOT}/"

echo "==> Reiniciar API"
if systemctl is-active --quiet facutools-backend 2>/dev/null; then
  if systemctl restart facutools-backend 2>/dev/null; then
    echo "Servicio reiniciado."
  else
    echo "No se pudo reiniciar systemd (¿falta sudo?). Ejecutá como root:"
    echo "  sudo systemctl restart facutools-backend"
  fi
else
  echo "Servicio facutools-backend no activo. Arrancalo como root:"
  echo "  sudo systemctl enable --now facutools-backend"
fi

echo "Deploy listo."
