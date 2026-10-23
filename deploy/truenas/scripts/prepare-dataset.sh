#!/bin/sh
# Crea la estructura de directorios en TrueNAS para FacuTools.
# Uso: ./prepare-dataset.sh [/mnt/pool/apps/facutools]

set -e

BASE="${1:-/mnt/pool/apps/facutools}"

mkdir -p "${BASE}/data/postgres" "${BASE}/data/certs" "${BASE}/repo" "${BASE}/deploy"

# Permisos amplios para que el contenedor (root) pueda escribir Postgres y certs
chmod -R 775 "${BASE}/data"

echo "Dataset listo en ${BASE}"
echo "  data/postgres/ → volumen persistente de PostgreSQL"
echo "  data/certs/    → certificados ACME"
echo "  repo/          → clonar aquí el repositorio de FacuTools"
echo ""
echo "Siguiente paso:"
echo "  git clone <url> ${BASE}/repo"
echo "  cp ${BASE}/repo/deploy/truenas/.env.example ${BASE}/deploy/.env"
echo "  # Editar POSTGRES_PASSWORD en ${BASE}/deploy/.env"
echo "  cd ${BASE}/repo/deploy/truenas && docker compose --env-file ${BASE}/deploy/.env up -d --build"
