#!/usr/bin/env bash
# Restaura un backup creado con backup.sh
# Uso: ./restore.sh /ruta/a/facutools-YYYYMMDD-HHMMSS.tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Uso: $0 /ruta/a/facutools-*.tar.gz" >&2
  exit 1
fi

cd "$VM_DIR"
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source .env
set +a

DATA_DIR="${FACUTOOLS_DATA:-${VM_DIR}/data}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "→ Extrayendo ${ARCHIVE}..."
tar -xzf "$ARCHIVE" -C "$WORKDIR"

echo "WARNING: esto SOBREESCRIBE la base actual."
read -r -p "¿Continuar? [y/N] " ans
[[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || exit 1

echo "→ Restaurando Postgres..."
docker compose --env-file .env exec -T db \
  pg_restore -U "${POSTGRES_USER:-facutools}" -d "${POSTGRES_DB:-facutools}" \
  --clean --if-exists --no-owner \
  <"${WORKDIR}/facutools.dump"

if [[ -d "${WORKDIR}/certs" ]]; then
  echo "→ Restaurando certificados..."
  mkdir -p "${DATA_DIR}/certs"
  cp -a "${WORKDIR}/certs/." "${DATA_DIR}/certs/"
fi

echo "→ Reiniciando backend..."
docker compose --env-file .env restart backend

echo "Restore OK."
