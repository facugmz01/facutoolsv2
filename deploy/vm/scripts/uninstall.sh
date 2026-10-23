#!/usr/bin/env bash
# Detiene y elimina contenedores (NO borra datos en FACUTOOLS_DATA).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$VM_DIR"
if [[ -f .env ]]; then
  docker compose --env-file .env down
else
  docker compose down
fi
echo "Stack detenido. Datos en disco intactos."
