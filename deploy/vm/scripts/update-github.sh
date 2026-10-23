#!/usr/bin/env bash
# Actualiza FacuTools desde GitHub: código, imágenes base, esquema de base de datos y (opcional) el sistema operativo.
# Hace backup previo, migra la base de datos, verifica salud y revierte el código si algo falla.
#
# Uso: sudo facutools-update [opciones]
#   --ref <rama|tag|commit>  Versión a desplegar (default: la rama instalada, guardada en .deploy-ref)
#   --check                  Solo indica si hay una versión nueva
#   --force                  Reconstruye aunque no haya cambios (refresca imágenes base)
#   --os-upgrade             Además ejecuta apt-get upgrade en el host
#   --no-backup              Omite el backup previo
#   --no-rollback            No revierte el código ante un fallo
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SELF")"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${VM_DIR}/../.." && pwd)"

REF=""; CHECK=0; FORCE=0; OS_UPGRADE=0; BACKUP=1; ROLLBACK=1

log() { printf '→ %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

dc() { docker compose --env-file .env "$@"; }

wait_backend() {
  for _ in $(seq 1 90); do
    if dc exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

wait_db() {
  for _ in $(seq 1 40); do
    dc exec -T db pg_isready -q >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

# Agrega claves requeridas que falten en .env (instalaciones antiguas) sin tocar las existentes.
ensure_env() {
  local f="${VM_DIR}/.env"
  [[ -f "$f" ]] || die "Falta ${f}; ejecutá install-github.sh primero."
  grep -q '^SECRET_KEY=' "$f" || echo "SECRET_KEY=$(openssl rand -hex 32)" >>"$f"
  grep -q '^CLIENT_SECRET_ENCRYPTION_KEY=' "$f" \
    || echo "CLIENT_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n')" >>"$f"
}

resolve_target() {
  git rev-parse --verify -q "origin/${REF}^{commit}" \
    || git rev-parse --verify -q "refs/tags/${REF}^{commit}" \
    || git rev-parse --verify -q "${REF}^{commit}" \
    || return 1
}

deploy() {
  cd "$VM_DIR"
  dc pull db redis || warn "No se pudieron actualizar las imágenes base de db/redis."
  dc build --pull
  dc up -d db redis
  wait_db || { warn "Postgres no respondió."; return 1; }
  # Migraciones versionadas; init_db de la app aplica además tablas/columnas nuevas al arrancar.
  dc run --rm --no-deps backend alembic upgrade head || { warn "Falló la migración de base de datos."; return 1; }
  dc up -d --remove-orphans
  wait_backend || { warn "El backend no quedó saludable."; return 1; }
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ref) REF="${2:?falta valor para --ref}"; shift 2 ;;
      --check) CHECK=1; shift ;;
      --force) FORCE=1; shift ;;
      --os-upgrade) OS_UPGRADE=1; shift ;;
      --no-backup) BACKUP=0; shift ;;
      --no-rollback) ROLLBACK=0; shift ;;
      -h|--help) sed -n '2,13p' "$SELF"; return 0 ;;
      *) die "Flag desconocido: $1" ;;
    esac
  done

  command -v docker >/dev/null 2>&1 || die "Docker no está instalado."
  [[ -d "${REPO_ROOT}/.git" ]] || die "${REPO_ROOT} no es un repositorio git."
  ensure_env

  exec 9>"${VM_DIR}/.update.lock"
  flock -n 9 || die "Ya hay una actualización en curso."

  cd "$REPO_ROOT"
  local pinned_branch=0
  if [[ -z "$REF" ]]; then
    REF="$(cat "${VM_DIR}/.deploy-ref" 2>/dev/null || echo main)"
  fi

  local prev target
  prev="$(git rev-parse HEAD)"
  git fetch --tags --prune --force origin
  target="$(resolve_target)" || die "No se encontró '${REF}' en GitHub."
  git rev-parse --verify -q "origin/${REF}^{commit}" >/dev/null && pinned_branch=1

  log "Versión actual: $(cat VERSION 2>/dev/null || echo '?') (${prev:0:8}) → destino: ${REF} (${target:0:8})"

  if [[ "$prev" == "$target" && "$FORCE" -eq 0 && "$OS_UPGRADE" -eq 0 ]]; then
    echo "Ya estás en la última versión."
    return 0
  fi
  if [[ "$CHECK" -eq 1 ]]; then
    echo "Hay cambios disponibles:"; git log --oneline "${prev}..${target}" | head -20
    return 0
  fi

  if [[ "$prev" != "$target" ]]; then
    echo "Cambios:"; git log --oneline "${prev}..${target}" | head -20
  fi

  if [[ "$OS_UPGRADE" -eq 1 ]]; then
    log "Actualizando paquetes del sistema operativo..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
    [[ -f /var/run/reboot-required ]] && warn "El sistema requiere reinicio (reboot) para completar la actualización."
  fi

  local backup_file=""
  if [[ "$BACKUP" -eq 1 ]]; then
    log "Backup previo..."
    if (cd "$VM_DIR" && dc up -d db redis >/dev/null && wait_db && bash "${SCRIPT_DIR}/backup.sh"); then
      backup_file="$(ls -t "${VM_DIR}"/backups/*.tar.gz 2>/dev/null | head -1 || true)"
    else
      warn "El backup falló; se continúa sin él."
    fi
  fi

  git checkout -q --detach "$target" || die "No se pudo cambiar de versión (¿cambios locales? usá git stash)."
  [[ "$pinned_branch" -eq 1 ]] && printf '%s\n' "$REF" >"${VM_DIR}/.deploy-ref"

  log "Reconstruyendo, migrando y reiniciando..."
  if ! deploy; then
    echo "ERROR: la actualización falló." >&2
    (cd "$VM_DIR" && dc logs --tail=50 backend >&2) || true
    if [[ "$ROLLBACK" -eq 1 && "$prev" != "$target" ]]; then
      log "Revirtiendo el código a ${prev:0:8}..."
      git checkout -q --detach "$prev"
      deploy || warn "El rollback tampoco quedó saludable; revisá los logs."
      [[ -n "$backup_file" ]] && warn "Si la base quedó inconsistente, restaurá: bash ${SCRIPT_DIR}/restore.sh ${backup_file}"
    fi
    return 1
  fi

  docker image prune -f >/dev/null 2>&1 || true
  cd "$VM_DIR"
  dc ps
  echo "OK — versión: $(cat "${REPO_ROOT}/VERSION" 2>/dev/null || echo '?')"
}

# Todo en una sola línea: el script puede ser reemplazado por git durante la ejecución.
main "$@"; exit $?
