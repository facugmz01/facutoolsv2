#!/usr/bin/env bash
# Instala FacuTools desde GitHub en una VM Ubuntu/Debian (Docker Compose + PostgreSQL + Redis).
# Instala dependencias, pide los datos, despliega y crea el superadmin inicial.
#
# Uso (como root):
#   sudo bash install-github.sh
#   curl -fsSL <URL-RAW>/deploy/vm/scripts/install-github.sh | sudo bash   # repo publico
#
# Valores por defecto sobrescribibles por entorno (modo no interactivo):
#   FT_REPO_URL FT_REF FT_GITHUB_TOKEN FT_INSTALL_DIR FT_DATA_DIR FT_HTTP_PORT
#   FT_ORG_NAME FT_ADMIN_NAME FT_ADMIN_EMAIL FT_ADMIN_PASSWORD FT_AUTO_UPDATE (s|n)
set -euo pipefail

log() { printf '\n→ %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Ejecutá como root: sudo bash $0"
command -v apt-get >/dev/null 2>&1 || die "Solo Ubuntu/Debian (apt) está soportado."

ask() { # var, prompt, default
  local var="$1" prompt="$2" def="${3:-}" ans=""
  [[ -n "${!var:-}" ]] && return 0
  [[ -r /dev/tty ]] || die "Falta ${var} y no hay terminal interactiva."
  if [[ -n "$def" ]]; then printf '%s [%s]: ' "$prompt" "$def" >/dev/tty; else printf '%s: ' "$prompt" >/dev/tty; fi
  IFS= read -r ans </dev/tty || true
  printf -v "$var" '%s' "${ans:-$def}"
}

ask_secret() { # var, prompt
  local var="$1" prompt="$2" ans=""
  [[ -n "${!var:-}" ]] && return 0
  [[ -r /dev/tty ]] || die "Falta ${var} y no hay terminal interactiva."
  printf '%s: ' "$prompt" >/dev/tty
  IFS= read -r -s ans </dev/tty || true
  printf '\n' >/dev/tty
  printf -v "$var" '%s' "$ans"
}

echo "═══════════════════════════════════════"
echo "  FacuTools — instalación desde GitHub"
echo "═══════════════════════════════════════"

# ── 1. Datos de configuración ────────────────────────────────────────────────
REPO_URL="${FT_REPO_URL:-}";   ask REPO_URL "URL del repositorio" "https://github.com/facugmz01/facutoolsv2.git"
REF="${FT_REF:-}";             ask REF "Rama o tag a instalar" "main"
TOKEN="${FT_GITHUB_TOKEN:-}"
if [[ -z "$TOKEN" && -r /dev/tty ]]; then
  ask_secret TOKEN "Token de GitHub (solo lectura; Enter si el repo es público)"
fi
INSTALL_DIR="${FT_INSTALL_DIR:-}"; ask INSTALL_DIR "Directorio de instalación" "/opt/facutools"
DATA_DIR="${FT_DATA_DIR:-}";   ask DATA_DIR "Directorio de datos (Postgres, certificados)" "${INSTALL_DIR}/data"
HTTP_PORT="${FT_HTTP_PORT:-}"; ask HTTP_PORT "Puerto HTTP" "80"
ORG_NAME="${FT_ORG_NAME:-}";   ask ORG_NAME "Nombre de la organización" "FacuTools"
ADMIN_NAME="${FT_ADMIN_NAME:-}";   ask ADMIN_NAME "Nombre del superadmin" "Admin"
ADMIN_EMAIL="${FT_ADMIN_EMAIL:-}"; ask ADMIN_EMAIL "Email del superadmin"
ADMIN_PASSWORD="${FT_ADMIN_PASSWORD:-}"
AUTO_UPDATE="${FT_AUTO_UPDATE:-}"; ask AUTO_UPDATE "¿Activar actualización automática diaria? (s/n)" "n"

[[ "$HTTP_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" -ge 1 && "$HTTP_PORT" -le 65535 ]] || die "Puerto inválido: $HTTP_PORT"
[[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Email inválido: $ADMIN_EMAIL"

if [[ -z "$ADMIN_PASSWORD" ]]; then
  while true; do
    ask_secret ADMIN_PASSWORD "Contraseña del superadmin (mín. 8 caracteres)"
    pass2=""
    ask_secret pass2 "Repetí la contraseña"
    if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
      echo "La contraseña debe tener al menos 8 caracteres." >/dev/tty; ADMIN_PASSWORD=""
    elif [[ "$ADMIN_PASSWORD" != "$pass2" ]]; then
      echo "Las contraseñas no coinciden." >/dev/tty; ADMIN_PASSWORD=""
    else
      break
    fi
  done
elif [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
  die "FT_ADMIN_PASSWORD debe tener al menos 8 caracteres."
fi

# ── 2. Dependencias del sistema ──────────────────────────────────────────────
log "Instalando dependencias (git, curl, openssl, ca-certificates)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git openssl

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "Docker ya instalado: $(docker --version)"
    return
  fi
  log "Instalando Docker Engine + Compose..."
  . /etc/os-release
  local distro="${ID:-ubuntu}"
  case "$distro" in debian|ubuntu) ;; *) distro="ubuntu" ;; esac
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${distro} ${VERSION_CODENAME:-stable} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}
install_docker

# ── 3. Clonar desde GitHub ───────────────────────────────────────────────────
REPO_DIR="${INSTALL_DIR}/repo"
mkdir -p "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"
GIT_OPTS=()
if [[ -n "$TOKEN" ]]; then
  CRED_FILE="${INSTALL_DIR}/.git-credentials"
  host="$(printf '%s' "$REPO_URL" | sed -E 's#^https?://([^/]+)/.*#\1#')"
  ( umask 077; printf 'https://x-access-token:%s@%s\n' "$TOKEN" "$host" >"$CRED_FILE" )
  GIT_OPTS=(-c "credential.helper=store --file=${CRED_FILE}")
fi
unset TOKEN FT_GITHUB_TOKEN

log "Descargando el código (${REPO_URL}, ${REF})..."
if [[ -d "${REPO_DIR}/.git" ]]; then
  git -C "$REPO_DIR" "${GIT_OPTS[@]}" fetch --tags --prune origin
else
  git "${GIT_OPTS[@]}" clone "$REPO_URL" "$REPO_DIR"
fi
if git -C "$REPO_DIR" rev-parse --verify -q "origin/${REF}^{commit}" >/dev/null; then
  git -C "$REPO_DIR" checkout -q --detach "origin/${REF}"
else
  git -C "$REPO_DIR" checkout -q --detach "$REF"
fi
if [[ -n "${CRED_FILE:-}" ]]; then
  git -C "$REPO_DIR" config credential.helper "store --file=${CRED_FILE}"
fi

VM_DIR="${REPO_DIR}/deploy/vm"
[[ -f "${VM_DIR}/docker-compose.yml" ]] || die "No se encontró deploy/vm/docker-compose.yml en el repo."
printf '%s\n' "$REF" >"${VM_DIR}/.deploy-ref"

# ── 4. Archivo .env ──────────────────────────────────────────────────────────
rand_alnum() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32; }
rand_fernet() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'; }

mkdir -p "${DATA_DIR}/postgres" "${DATA_DIR}/redis" "${DATA_DIR}/certs"
ENV_FILE="${VM_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generando ${ENV_FILE} con secretos aleatorios..."
  ( umask 077; cat >"$ENV_FILE" <<EOF
FACUTOOLS_HTTP_PORT=${HTTP_PORT}
FACUTOOLS_DATA=${DATA_DIR}
POSTGRES_USER=facutools
POSTGRES_PASSWORD=$(rand_alnum)
POSTGRES_DB=facutools
SECRET_KEY=$(openssl rand -hex 32)
CLIENT_SECRET_ENCRYPTION_KEY=$(rand_fernet)
EOF
  )
else
  log "Usando ${ENV_FILE} existente."
fi
chmod 600 "$ENV_FILE"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  log "ufw activo: permitiendo ${HTTP_PORT}/tcp"
  ufw allow "${HTTP_PORT}/tcp" || true
fi

# ── 5. Despliegue ────────────────────────────────────────────────────────────
cd "$VM_DIR"
dc() { docker compose --env-file .env "$@"; }

log "Construyendo y levantando el stack (puede tardar varios minutos)..."
dc up -d --build

log "Esperando al backend..."
healthy=0
for _ in $(seq 1 90); do
  if dc exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 3
done
[[ "$healthy" -eq 1 ]] || { dc logs --tail=50 backend >&2; die "El backend no quedó saludable."; }

# Las tablas ya fueron creadas por la app; esto marca la versión de esquema para futuras migraciones.
dc exec -T backend alembic stamp head || echo "WARNING: alembic stamp falló (se reintenta en el update)." >&2

# ── 6. Superadmin inicial ────────────────────────────────────────────────────
log "Creando superadmin inicial..."
export FACUTOOLS_ADMIN_EMAIL="$ADMIN_EMAIL" FACUTOOLS_ADMIN_NAME="$ADMIN_NAME" \
       FACUTOOLS_ADMIN_PASSWORD="$ADMIN_PASSWORD" FACUTOOLS_ORG_NAME="$ORG_NAME"
dc exec -T \
  -e FACUTOOLS_ADMIN_EMAIL -e FACUTOOLS_ADMIN_NAME -e FACUTOOLS_ADMIN_PASSWORD -e FACUTOOLS_ORG_NAME \
  backend python -m app.create_superadmin
unset FACUTOOLS_ADMIN_PASSWORD ADMIN_PASSWORD FT_ADMIN_PASSWORD

# ── 7. Comando de update y actualización automática ──────────────────────────
UPDATE_SCRIPT="${VM_DIR}/scripts/update-github.sh"
chmod +x "$UPDATE_SCRIPT" 2>/dev/null || true
ln -sf "$UPDATE_SCRIPT" /usr/local/bin/facutools-update

if [[ "${AUTO_UPDATE,,}" =~ ^(s|si|sí|y|yes)$ ]]; then
  log "Programando actualización diaria (04:00) en /etc/cron.d/facutools-update"
  echo "0 4 * * * root /usr/local/bin/facutools-update >> /var/log/facutools-update.log 2>&1" >/etc/cron.d/facutools-update
  chmod 644 /etc/cron.d/facutools-update
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"
URL="http://${HOST_IP}"
[[ "$HTTP_PORT" == "80" ]] || URL="${URL}:${HTTP_PORT}"

echo ""
echo "═══════════════════════════════════════"
echo "  Instalación completa"
echo "═══════════════════════════════════════"
echo "UI:          ${URL}"
echo "Superadmin:  ${ADMIN_EMAIL}"
echo "Datos:       ${DATA_DIR}"
echo "Secretos:    ${ENV_FILE}  (hacé backup de este archivo)"
echo "Actualizar:  sudo facutools-update   (--check para solo consultar)"
echo "Backup:      bash ${VM_DIR}/scripts/backup.sh"
echo "Para HTTPS, poné un proxy inverso delante (ver deploy/vm/nginx-proxy.conf.example)."
echo ""
dc ps
