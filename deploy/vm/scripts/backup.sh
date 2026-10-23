#!/usr/bin/env bash
# Backup de PostgreSQL + certificados ACME.
# Destino default: ./backups/facutools-YYYYMMDD-HHMMSS.tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$VM_DIR"
if [[ ! -f .env ]]; then
  echo "ERROR: falta ${VM_DIR}/.env" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source .env
set +a

DATA_DIR="${FACUTOOLS_DATA:-${VM_DIR}/data}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-${VM_DIR}/backups}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$OUT_DIR" "$WORKDIR/certs"

echo "→ pg_dump..."
docker compose --env-file .env exec -T db \
  pg_dump -U "${POSTGRES_USER:-facutools}" -d "${POSTGRES_DB:-facutools}" \
  --no-owner --format=custom \
  >"${WORKDIR}/facutools.dump"

if [[ -d "${DATA_DIR}/certs" ]]; then
  echo "→ Copiando certificados..."
  cp -a "${DATA_DIR}/certs/." "${WORKDIR}/certs/" 2>/dev/null || true
fi

ARCHIVE="${OUT_DIR}/facutools-${STAMP}.tar.gz"
tar -czf "$ARCHIVE" -C "$WORKDIR" facutools.dump certs
chmod 600 "$ARCHIVE"

echo "Backup OK: ${ARCHIVE}"
ls -lh "$ARCHIVE"
