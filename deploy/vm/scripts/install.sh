#!/usr/bin/env bash
# Instala FacuTools en una VM (Ubuntu/Debian/similar) con Docker Compose.
# Ejecutar desde cualquier lado; se ancla a deploy/vm del repo.
#
# Uso:
#   curl -fsSL ... | bash   # (si publicás el script)
#   o:  cd /opt/facutools/repo && bash deploy/vm/scripts/install.sh
#
# Flags:
#   --port N          Puerto HTTP (default 80)
#   --data DIR        Directorio de datos (default ./data junto al compose)
#   --no-docker-install  No instalar Docker (asumir que ya está)
#   --skip-build      Solo up -d sin --build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${VM_DIR}/../.." && pwd)"

HTTP_PORT="${FACUTOOLS_HTTP_PORT:-80}"
DATA_DIR=""
INSTALL_DOCKER=1
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) HTTP_PORT="$2"; shift 2 ;;
    --data) DATA_DIR="$2"; shift 2 ;;
    --no-docker-install) INSTALL_DOCKER=0; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Flag desconocido: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${REPO_ROOT}/backend/Dockerfile" || ! -f "${REPO_ROOT}/frontend/Dockerfile.prod" ]]; then
  echo "ERROR: no se encontró el repo FacuTools en ${REPO_ROOT}" >&2
  echo "Cloná el repositorio y ejecutá este script desde deploy/vm/scripts/install.sh" >&2
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Falta el comando: $1" >&2
    exit 1
  }
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "→ Docker ya instalado: $(docker --version)"
    return
  fi

  echo "→ Instalando Docker Engine + Compose plugin..."
  need_cmd curl
  if [[ "$(id -u)" -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi

  $SUDO apt-get update -y
  $SUDO apt-get install -y ca-certificates curl
  $SUDO install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    $SUDO curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  fi

  # Detectar distro (Ubuntu/Debian)
  . /etc/os-release
  local codename="${VERSION_CODENAME:-stable}"
  local distro_id="${ID:-ubuntu}"
  case "$distro_id" in
    debian|ubuntu) ;;
    *) distro_id="ubuntu" ;;
  esac

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${distro_id} ${codename} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if [[ "$(id -u)" -ne 0 ]]; then
    $SUDO usermod -aG docker "$USER" || true
    echo "→ Usuario $USER agregado al grupo docker (puede hacer falta re-login)."
  fi

  $SUDO systemctl enable --now docker
  echo "→ Docker instalado."
}

gen_password() {
  # Alfanumérico: seguro para URLs en DATABASE_URL sin encoding
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32
  else
    head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 32
  fi
}

gen_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Fernet = 32 bytes en base64 url-safe
gen_fernet() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n'
  fi
}

echo "═══════════════════════════════════════"
echo "  FacuTools — instalación en VM"
echo "═══════════════════════════════════════"
echo "Repo:    ${REPO_ROOT}"
echo "Compose: ${VM_DIR}"
echo ""

if [[ "$INSTALL_DOCKER" -eq 1 ]]; then
  install_docker
else
  need_cmd docker
  docker compose version >/dev/null
fi

# Resolver data dir
if [[ -z "$DATA_DIR" ]]; then
  DATA_DIR="${VM_DIR}/data"
fi
mkdir -p "${DATA_DIR}/postgres" "${DATA_DIR}/redis" "${DATA_DIR}/certs"
chmod 775 "${DATA_DIR}" || true

ENV_FILE="${VM_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "→ Creando ${ENV_FILE}"
  PASS="$(gen_password)"
  cat >"$ENV_FILE" <<EOF
FACUTOOLS_HTTP_PORT=${HTTP_PORT}
FACUTOOLS_DATA=${DATA_DIR}
POSTGRES_USER=facutools
POSTGRES_PASSWORD=${PASS}
POSTGRES_DB=facutools
SECRET_KEY=$(gen_hex)
CLIENT_SECRET_ENCRYPTION_KEY=$(gen_fernet)
EOF
  chmod 600 "$ENV_FILE"
  echo "→ Secretos generados y guardados en .env (chmod 600). Hacé backup de este archivo."
else
  echo "→ Usando .env existente: ${ENV_FILE}"
  # Asegurar DATA_DIR / puerto si faltan
  grep -q '^FACUTOOLS_DATA=' "$ENV_FILE" || echo "FACUTOOLS_DATA=${DATA_DIR}" >>"$ENV_FILE"
  grep -q '^FACUTOOLS_HTTP_PORT=' "$ENV_FILE" || echo "FACUTOOLS_HTTP_PORT=${HTTP_PORT}" >>"$ENV_FILE"
  grep -q '^SECRET_KEY=' "$ENV_FILE" || echo "SECRET_KEY=$(gen_hex)" >>"$ENV_FILE"
  grep -q '^CLIENT_SECRET_ENCRYPTION_KEY=' "$ENV_FILE" || echo "CLIENT_SECRET_ENCRYPTION_KEY=$(gen_fernet)" >>"$ENV_FILE"
fi

# Abrir firewall si ufw está activo
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  echo "→ ufw activo: permitiendo puerto ${HTTP_PORT}/tcp"
  if [[ "$(id -u)" -eq 0 ]]; then
    ufw allow "${HTTP_PORT}/tcp" || true
  else
    sudo ufw allow "${HTTP_PORT}/tcp" || true
  fi
fi

cd "$VM_DIR"
echo "→ Levantando stack (build puede tardar varios minutos)..."
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  docker compose --env-file .env up -d
else
  docker compose --env-file .env up -d --build
fi

echo ""
echo "→ Esperando health del backend..."
for i in $(seq 1 60); do
  if docker compose --env-file .env exec -T backend \
    python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [[ "$i" -eq 60 ]]; then
    echo "WARNING: backend aún no responde health. Revisá: docker compose -f ${VM_DIR}/docker-compose.yml logs" >&2
  fi
done

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"
PORT_DISP="${HTTP_PORT}"
if [[ "$PORT_DISP" == "80" ]]; then
  URL="http://${HOST_IP}"
else
  URL="http://${HOST_IP}:${PORT_DISP}"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Instalación completa"
echo "═══════════════════════════════════════"
echo "UI:          ${URL}"
echo "Health API:  ${URL}/api/health"
echo "Datos:       ${DATA_DIR}"
echo "Env:         ${ENV_FILE}"
echo ""
echo "Próximos pasos:"
echo "  1. Abrí la UI y registrá el primer admin"
echo "  2. Settings → Security: generá un secret_key nuevo"
echo "  3. Settings → General: api_public_url = URL pública (con https si usás proxy)"
echo "  4. Backup:  bash ${SCRIPT_DIR}/backup.sh"
echo "  5. Update:  bash ${SCRIPT_DIR}/update.sh"
echo ""
docker compose --env-file .env ps
