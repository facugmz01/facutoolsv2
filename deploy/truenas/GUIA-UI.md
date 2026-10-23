# FacuTools en TrueNAS — guía según la pantalla que ves

## Importante: no uses el formulario de una sola imagen

La pantalla **Instalar App personalizada** con estos campos:

- Application Name
- Image Repository / Image Tag
- Container Command
- Port Forwarding
- Host Path Volumes

…sirve para **un solo contenedor** que descarga una imagen ya publicada (ej. `nginx:latest`).

FacuTools necesita **dos contenedores** (backend + frontend) y se **construye desde el código** del repo. Ese formulario no alcanza.

---

## Opción recomendada: Install via YAML

1. **Datasets** → crear `apps/facutools` con subcarpetas `data` y `repo`.
2. **Shell** del NAS (o SSH):

```bash
git clone <url-del-repo> /mnt/pool/apps/facutools/repo
mkdir -p /mnt/pool/apps/facutools/data
chmod -R 775 /mnt/pool/apps/facutools/data
```

3. Editar `deploy/truenas/docker-compose.truenas.yaml` y cambiar `/mnt/pool` por tu pool real.
4. En TrueNAS: **Apps** → **Discover Apps**.
5. Junto a **Custom App**, abrí el menú **⋮** (tres puntos).
6. Elegí **Install via YAML** (no el formulario de la captura).
7. Pegá el contenido de `docker-compose.truenas.yaml`.
8. **Install**.

Tras el build (puede tardar varios minutos la primera vez), la app aparece en **Installed Apps** con un botón **FacuTools** que abre `http://<nas>:8080`.

---

## Si solo ves el formulario (una imagen)

No podés desplegar FacuTools completo ahí. Alternativas:

| Método | Cuándo usarlo |
|--------|----------------|
| **Install via YAML** | TrueNAS 24.10+ (Electric Eel) — recomendado |
| **SSH + docker compose** | Cualquier versión con Docker |
| **Dockge / Portainer / Arcane** | Si preferís gestionar stacks con UI (Arcane: [`../arcane/README.md`](../arcane/README.md)) |

### SSH (si no tenés Install via YAML)

```bash
cd /mnt/pool/apps/facutools/repo/deploy/truenas
cp .env.example /mnt/pool/apps/facutools/deploy/.env
# editar .env con tus rutas
docker compose --env-file /mnt/pool/apps/facutools/deploy/.env up -d --build
```

---

## Referencia: qué iría en el formulario (solo backend, no recomendado)

Si intentaras instalar **solo el backend** en el formulario (sin frontend nginx), necesitarías una imagen en un registry. Hoy FacuTools no publica imágenes pre-built; habría que construirlas antes:

```bash
cd /mnt/pool/apps/facutools/repo
docker build -t facutools-backend:local ./backend
docker build -f frontend/Dockerfile.prod -t facutools-frontend:local ./frontend
```

Luego, para el **backend** en el formulario:

| Campo | Valor |
|-------|-------|
| Application Name | `facutools-backend` |
| Image Repository | `facutools-backend` |
| Image Tag | `local` |
| Image Pull Policy | `Never` o `IfNotPresent` |
| Environment Variables | `DATABASE_URL` = `postgresql+asyncpg://facutools:PASSWORD@facutools-db:5432/facutools` |
| Host Path Volumes | Host: `/mnt/pool/apps/facutools/data` → Mount: `/app/data` |
| Port Forwarding | *(ninguno — solo interno)* |

Y repetir otro Custom App para el **frontend** con imagen `facutools-frontend:local`, puerto `8080:80`, y red compartida — es más frágil que el compose de una sola vez.

---

## Post-instalación

1. Abrí `http://<ip-del-nas>:8080`
2. En **Settings** → General: `api_public_url` con tu URL real
3. En **Settings** → Security: nuevo `secret_key`
4. Revisá los logs del backend para las credenciales del admin inicial
