#!/usr/bin/env bash
# Instalación inicial FacuTools en CloudPanel (sin Docker).
# Ejecutar como el usuario del sitio (SITEUSER), desde el clon del repo:
#   export APP_ROOT=$HOME/apps/facutools
#   export WEB_ROOT=$HOME/htdocs/tudominio.com
#   bash deploy/cloudpanel/scripts/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

APP_ROOT="${APP_ROOT:-$HOME/apps/facutools}"
WEB_ROOT="${WEB_ROOT:-}"

if [[ -z "${WEB_ROOT}" ]]; then
  echo "Error: definí WEB_ROOT (ruta htdocs del sitio), ej:"
  echo "  export WEB_ROOT=\$HOME/htdocs/facutools.example.com"
  exit 1
fi

echo "==> APP_ROOT=${APP_ROOT}"
echo "==> WEB_ROOT=${WEB_ROOT}"
echo "==> REPO_ROOT=${REPO_ROOT}"

mkdir -p "${APP_ROOT}/data"
chmod 775 "${APP_ROOT}/data"

# Enlace o copia: el repo puede estar en APP_ROOT/repo
if [[ "${REPO_ROOT}" != "${APP_ROOT}/repo" ]]; then
  mkdir -p "${APP_ROOT}"
  if [[ ! -e "${APP_ROOT}/repo" ]]; then
    ln -sfn "${REPO_ROOT}" "${APP_ROOT}/repo"
    echo "==> Symlink ${APP_ROOT}/repo → ${REPO_ROOT}"
  fi
fi

if [[ ! -f "${APP_ROOT}/.env" ]]; then
  cp "${REPO_ROOT}/deploy/cloudpanel/env.example" "${APP_ROOT}/.env"
  echo "==> Creado ${APP_ROOT}/.env"
fi

echo "==> Python venv"
python3 -m venv "${APP_ROOT}/venv"
# shellcheck disable=SC1091
source "${APP_ROOT}/venv/bin/activate"
pip install --upgrade pip
pip install -r "${REPO_ROOT}/backend/requirements.txt"

echo "==> Frontend build"
cd "${REPO_ROOT}/frontend"
npm install
npm run build

echo "==> Publicar estáticos en ${WEB_ROOT}"
mkdir -p "${WEB_ROOT}"
rsync -a --delete "${REPO_ROOT}/frontend/dist/" "${WEB_ROOT}/"

echo ""
echo "Instalación de app lista."
echo "Siguiente (como root): instalar systemd y nginx — ver deploy/cloudpanel/README.md"
echo "  sed ... facutools-backend.service > /etc/systemd/system/facutools-backend.service"
echo "  systemctl enable --now facutools-backend"
