#!/usr/bin/env bash
# Actualiza FacuTools en la VM: backup + git pull + rebuild + healthcheck + rollback automático.
#
# Uso:
#   update.sh [--ref <tag|branch|commit>] [--no-backup] [--no-rollback]
#
# Sin --ref hace `git pull --ff-only` de la rama actual.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${VM_DIR}/../.." && pwd)"

REF=""
BACKUP=1
ROLLBACK=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --no-backup) BACKUP=0; shift ;;
    --no-rollback) ROLLBACK=0; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Flag desconocido: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "${VM_DIR}/.env" ]]; then
  echo "ERROR: falta ${VM_DIR}/.env — ejecutá install.sh primero." >&2
  exit 1
fi

# Evita dos despliegues simultáneos
exec 9>"${VM_DIR}/.update.lock"
flock -n 9 || { echo "ERROR: ya hay una actualización en curso." >&2; exit 1; }

cd "$REPO_ROOT"
PREV_COMMIT=""
if [[ -d .git ]]; then
  PREV_COMMIT="$(git rev-parse HEAD)"
  echo "→ Versión actual: $(cat VERSION 2>/dev/null || echo '?') (${PREV_COMMIT:0:8})"
  if [[ -n "$REF" ]]; then
    git fetch --tags --prune origin
    git checkout --detach "$REF"
  else
    git pull --ff-only
  fi
else
  echo "WARNING: no es un repo git; solo rebuild de lo que haya en disco."
fi

cd "$VM_DIR"

if [[ "$BACKUP" -eq 1 ]]; then
  echo "→ Backup previo..."
  bash "${SCRIPT_DIR}/backup.sh" || echo "WARNING: backup falló, se continúa." >&2
fi

wait_healthy() {
  for _ in $(seq 1 60); do
    if docker compose --env-file .env exec -T backend \
      python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

deploy() {
  docker compose --env-file .env up -d --build --remove-orphans
  wait_healthy
}

echo "→ Rebuild y restart..."
if ! deploy; then
  echo "ERROR: el backend no quedó saludable." >&2
  if [[ "$ROLLBACK" -eq 1 && -n "$PREV_COMMIT" ]]; then
    echo "→ Rollback a ${PREV_COMMIT:0:8}..." >&2
    (cd "$REPO_ROOT" && git checkout --detach "$PREV_COMMIT")
    deploy || echo "ERROR: el rollback tampoco quedó saludable; revisá los logs." >&2
  fi
  docker compose --env-file .env logs --tail=50 backend >&2 || true
  exit 1
fi

docker image prune -f >/dev/null 2>&1 || true

echo "→ Estado:"
docker compose --env-file .env ps
echo "OK — versión: $(cat "${REPO_ROOT}/VERSION" 2>/dev/null || echo '?')"
