# FacuTools en TrueNAS SCALE

Despliegue en producción con Docker Compose: frontend estático (nginx) + API FastAPI, datos persistentes en un dataset del pool.

## Coolify (más fácil, recomendado si ya lo usás)

Si tenés **Coolify** en TrueNAS, el despliegue es más simple: conectás el repo Git, elegís Docker Compose y asignás un dominio con HTTPS automático.

Guía completa: [`../coolify/README.md`](../coolify/README.md)

## Arcane (gestor Compose en TrueNAS)

Si usás **Arcane** en lugar de Dockge/Portainer: compose con rutas relativas y mount de `PROJECTS_DIRECTORY` con la misma ruta host ↔ contenedor.

Guía: [`../arcane/README.md`](../arcane/README.md)

## CloudPanel (sin Docker)

Si preferís un VPS con CloudPanel (nginx + systemd, sin contenedores): [`../cloudpanel/README.md`](../cloudpanel/README.md)


- TrueNAS SCALE 23.10+ con **Apps** habilitadas
- Dataset con al menos 2 GB libres (DB, certificados ACME, logs)
- Acceso SSH al NAS (recomendado para el primer deploy)

## Estructura en el NAS

```
/mnt/<pool>/apps/facutools/
├── data/          # Persistente — NO borrar (domaintools.db, certs/)
├── repo/          # Clon de este repositorio
└── deploy/
    └── .env       # Variables de entorno (copiar desde .env.example)
```

## Instalación rápida (SSH)

```bash
# 1. Crear directorios
sh /mnt/pool/apps/facutools/repo/deploy/truenas/scripts/prepare-dataset.sh /mnt/pool/apps/facutools

# 2. Clonar el repo (si aún no está)
git clone https://github.com/<tu-org>/domaintools.git /mnt/pool/apps/facutools/repo

# 3. Configurar variables
cp /mnt/pool/apps/facutools/repo/deploy/truenas/.env.example \
   /mnt/pool/apps/facutools/deploy/.env

# 4. Levantar servicios
cd /mnt/pool/apps/facutools/repo/deploy/truenas
docker compose --env-file /mnt/pool/apps/facutools/deploy/.env up -d --build
```

Abrir `http://<ip-del-nas>:8080` (o el puerto definido en `FACUTOOLS_HTTP_PORT`).

## Instalación desde la UI (TrueNAS)

> **No uses el formulario “Instalar App personalizada”** (Image Repository, Container Command, etc.). Ese asistente es para **una sola imagen** de Docker Hub. FacuTools usa **dos contenedores** y build local.
>
> Guía visual paso a paso: [`GUIA-UI.md`](GUIA-UI.md)

### Install via YAML (recomendado en TrueNAS 24.10+)

1. **Datasets** → crear `apps/facutools` con subcarpetas `data` y `repo`.
2. Clonar el repo en `repo/` y ajustar rutas en `docker-compose.truenas.yaml` (reemplazar `/mnt/pool`).
3. **Apps** → **Discover Apps** → menú **⋮** junto a Custom App → **Install via YAML**.
4. Pegar el contenido de `docker-compose.truenas.yaml` → **Install**.

El bloque `x-portals` agrega un acceso directo “FacuTools” en Installed Apps.

## Post-instalación

Tras el primer arranque, entrá a **Settings** en la UI y configurá:

- **General** → `api_public_url` con la URL real (`https://facutools.tudominio.com`)
- **Security** → `secret_key` (generar uno nuevo)
- **Security** → `cors_origins` si accedés desde otro origen

El usuario admin inicial se crea en el bootstrap del backend (ver logs del contenedor `facutools-backend`).

## HTTPS con reverse proxy

FacuTools escucha HTTP en el contenedor `frontend`. Para TLS:

- **Opción A:** Proxy inverso en TrueNAS (Traefik, Nginx Proxy Manager, o el ingress del NAS) apuntando al puerto `FACUTOOLS_HTTP_PORT`.
- **Opción B:** Certificado en el proxy y `api_public_url` en `https://...` para SSO y enlaces absolutos.

No montes certificados dentro del contenedor salvo que extiendas `nginx.conf`; el proxy externo es lo habitual en TrueNAS.

## Backup

Respaldar periódicamente el dataset `data/`:

```bash
tar -czf facutools-backup-$(date +%Y%m%d).tar.gz -C /mnt/pool/apps/facutools data
```

Incluye PostgreSQL (`data/postgres/`) y `./data/certs/` de Let's Encrypt.

Backup lógico de Postgres:

```bash
docker exec facutools-db pg_dump -U facutools facutools > facutools-$(date +%Y%m%d).sql
```

## Actualización

```bash
cd /mnt/pool/apps/facutools/repo
git pull
cd deploy/truenas
docker compose --env-file /mnt/pool/apps/facutools/deploy/.env up -d --build
```

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `permission denied` en `/app/data` | `chmod -R 775` en el dataset `data/` |
| 502 en la UI | Verificar health del backend: `docker logs facutools-backend` |
| SSO redirige mal | Ajustar `api_public_url` y headers `X-Forwarded-Proto` en el proxy |
| Puerto en uso | Cambiar `FACUTOOLS_HTTP_PORT` en `.env` |

## Desarrollo local vs producción

| Archivo | Uso |
|---------|-----|
| `/docker-compose.yml` (raíz) | Desarrollo — Vite dev server |
| `deploy/truenas/docker-compose.yml` | Producción — nginx + build estático |
