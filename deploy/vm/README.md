# FacuTools en una VM

Guía para instalar FacuTools en una máquina virtual (Ubuntu 22.04 / 24.04 recomendado) con **Docker Compose**, **PostgreSQL 16** y frontend en **nginx**.

## Requisitos

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disco | 10 GB | 20 GB+ |
| SO | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| Red | Puerto HTTP abierto (80 o el que elijas) | + 443 si usás HTTPS delante |

No hace falta instalar Python ni Node en el host: todo corre en contenedores.

## Instalación rápida (1 comando)

En la VM:

```bash
# 1. Clonar
sudo mkdir -p /opt/facutools
sudo chown "$USER:$USER" /opt/facutools
cd /opt/facutools
git clone <URL-DEL-REPO> repo
cd repo

# 2. Instalar (Docker + .env + build + up)
bash deploy/vm/scripts/install.sh --port 80 --data /opt/facutools/data
```

El script:

1. Instala Docker Engine + Compose (si faltan)
2. Genera `.env` con contraseña fuerte de Postgres
3. Crea el directorio de datos
4. Build y levanta `db` + `backend` + `frontend`
5. Abre el puerto en `ufw` si está activo

Abrí `http://<IP-DE-LA-VM>` y registrá el primer admin.

### Flags útiles

```bash
bash deploy/vm/scripts/install.sh --port 8080          # si 80 está ocupado
bash deploy/vm/scripts/install.sh --no-docker-install  # Docker ya instalado
bash deploy/vm/scripts/install.sh --data /var/lib/facutools
```

## Instalación manual

```bash
cd /opt/facutools/repo/deploy/vm
cp .env.example .env
nano .env   # cambiar POSTGRES_PASSWORD y FACUTOOLS_DATA
mkdir -p /opt/facutools/data/postgres /opt/facutools/data/certs

docker compose --env-file .env up -d --build
docker compose --env-file .env ps
curl -sS http://127.0.0.1/api/health
```

## Arquitectura

```
Internet → :80 nginx (frontend) → /api → backend:8000 → Postgres:5432
                 └─ static React build
```

- **Solo el frontend** publica puerto al host.
- Backend y Postgres están en la red Docker `facutools` (no expuestos).
- Datos en disco: `FACUTOOLS_DATA/postgres` + `FACUTOOLS_DATA/certs`.

## Post-instalación

1. Abrí la UI → **Register** (primer usuario = admin + organización).
2. **Settings → Security** → nuevo `secret_key`.
3. **Settings → General** → `api_public_url` = URL pública (ej. `https://facutools.tudominio.com`).
4. (Opcional) Configurar SMTP / ACME / notificaciones en Settings.

## HTTPS (recomendado en producción)

El compose sirve HTTP. Para HTTPS poné un reverse proxy delante.

### Opción A — Caddy en el host (automático Let's Encrypt)

Caddy necesita los puertos **80** y **443**. Mové FacuTools a otro puerto primero:

```bash
# 1) FacuTools en 8080 (libera el 80 para Caddy)
cd /opt/facutools/repo/deploy/vm
sed -i 's/^FACUTOOLS_HTTP_PORT=.*/FACUTOOLS_HTTP_PORT=8080/' .env
docker compose --env-file .env up -d

# 2) Caddyfile → proxy a 8080
sudo tee /etc/caddy/Caddyfile <<'EOF'
tools.facutest.com {
    reverse_proxy 127.0.0.1:8080
}
EOF

# 3) Arrancar Caddy (no "reload" si nunca estuvo activo)
sudo systemctl enable --now caddy
sudo systemctl status caddy --no-pager

# 4) Firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

DNS A de `tools.facutest.com` → IP pública de la VM. Luego en Settings: `api_public_url` = `https://tools.facutest.com`.

Si falla el certificado: `sudo journalctl -u caddy -n 50 --no-pager`

### Opción B — nginx en el host

Usá el ejemplo [`nginx-proxy.conf.example`](nginx-proxy.conf.example).

### Opción C — Cloudflare Tunnel / proxy

Tunnel o proxy naranja hacia el puerto de FacuTools; en Settings usá la URL `https://...`.

## Operación

| Tarea | Comando |
|-------|---------|
| Estado | `cd deploy/vm && docker compose --env-file .env ps` |
| Logs | `docker compose --env-file .env logs -f --tail=100` |
| Actualizar | `bash deploy/vm/scripts/update.sh [--ref v1.2.0]` |
| Backup | `bash deploy/vm/scripts/backup.sh` |
| Restore | `bash deploy/vm/scripts/restore.sh backups/facutools-....tar.gz` |
| Parar | `bash deploy/vm/scripts/uninstall.sh` |

Los backups van a `deploy/vm/backups/` (dump Postgres + certs). Guardalos fuera de la VM.

## Actualizaciones y despliegue continuo

`update.sh` hace: backup, `git pull` (o checkout de `--ref`), rebuild, espera al healthcheck del backend y, si falla, vuelve automáticamente al commit anterior. Usa un lock para evitar ejecuciones simultáneas.

### Automático con GitHub Actions

- `.github/workflows/ci.yml`: tests backend, build frontend y build de imágenes en cada PR/push a `main`.
- `.github/workflows/deploy.yml`: tras un CI exitoso en `main`, al publicar un tag `v*` o manualmente (con `ref` opcional), entra por SSH y ejecuta `update.sh`.

Secrets del environment `production`:

| Secret | Valor |
|--------|-------|
| `DEPLOY_HOST` | IP/dominio de la VM |
| `DEPLOY_USER` | usuario con acceso a docker |
| `DEPLOY_SSH_KEY` | clave privada dedicada (su pública va en `~/.ssh/authorized_keys` de la VM) |
| `DEPLOY_PATH` | ruta del repo, ej. `/opt/facutools/repo` |
| `DEPLOY_PORT` | opcional, default 22 |

El repo en la VM debe poder hacer `git fetch` (deploy key de solo lectura). Para desplegar solo con releases, quitá el trigger `workflow_run` de `deploy.yml`. Rollback manual: `update.sh --ref <tag-anterior>`.

## Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp   # si usás HTTPS
sudo ufw enable
```

**No** abras el puerto 5432 de Postgres al mundo.

## Variables de entorno (`.env`)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `FACUTOOLS_HTTP_PORT` | `80` | Puerto host del UI |
| `FACUTOOLS_DATA` | `./data` | Datos persistentes |
| `POSTGRES_USER` | `facutools` | Usuario DB |
| `POSTGRES_PASSWORD` | *(obligatorio)* | Contraseña DB |
| `POSTGRES_DB` | `facutools` | Nombre DB |

Archivo generado por `install.sh` queda con `chmod 600`.

## Troubleshooting

**Build falla / sin memoria:** la VM necesita ≥1 GB RAM; cerrá otros servicios o usá swap.

**Puerto 80 en uso:**

```bash
bash deploy/vm/scripts/install.sh --port 8080
```

**Backend unhealthy:**

```bash
cd deploy/vm
docker compose --env-file .env logs backend
docker compose --env-file .env logs db
```

**Permisos en data:**

```bash
sudo chown -R "$USER:$USER" /opt/facutools/data
```

**Recrear solo el frontend:**

```bash
docker compose --env-file .env up -d --build frontend
```
