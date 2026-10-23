# FacuTools en Arcane (TrueNAS)

Arcane gestiona proyectos Compose desde un directorio del host. Lo crítico: **la ruta del proyecto debe ser la misma dentro y fuera del contenedor de Arcane**, así los `build.context` relativos (`./backend`) funcionan.

## Estructura en el NAS

Usá tu carpeta actual, pero con el código al mismo nivel que el compose (sin depender de rutas absolutas):

```
/mnt/Datos/Archivos/facutools/
├── compose.yaml      ← copiar desde deploy/arcane/compose.yaml
├── .env              ← copiar desde deploy/arcane/.env.example
├── backend/          ← del repo
├── frontend/         ← del repo
└── data/             ← persistente (DB + certificados ACME)
```

### Preparar (SSH / Shell)

```bash
BASE=/mnt/Datos/Archivos/facutools
mkdir -p "$BASE/data"
chmod -R 775 "$BASE/data"

# Si ya tenés el clone en repo/:
#   mv "$BASE/repo/backend" "$BASE/repo/frontend" "$BASE/"   # o copiá
#   # y dejá compose.yaml en $BASE

# Si partís de cero:
git clone https://github.com/<tu-org>/domaintools.git /tmp/facutools-src
cp -a /tmp/facutools-src/backend /tmp/facutools-src/frontend "$BASE/"
cp /tmp/facutools-src/deploy/arcane/compose.yaml "$BASE/compose.yaml"
cp /tmp/facutools-src/deploy/arcane/.env.example "$BASE/.env"
```

Confirmá:

```bash
ls "$BASE/backend/Dockerfile" "$BASE/frontend/Dockerfile.prod" "$BASE/compose.yaml"
```

## Configurar Arcane (una sola vez)

Arcane necesita ver `/mnt/Datos/Archivos` con la **misma ruta** en el contenedor.

### Si Arcane es app de TrueNAS

1. **Apps** → **Arcane** → **Edit**
2. **Additional Storage** / Host Path:
   - Host Path: `/mnt/Datos/Archivos`
   - Mount Path: `/mnt/Datos/Archivos` (igual)
3. En variables / settings de Arcane:
   - `PROJECTS_DIRECTORY=/mnt/Datos/Archivos`
4. Guardá y reiniciá Arcane

### Si Arcane corre con su propio compose

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - arcane-data:/app/data
  - /mnt/Datos/Archivos:/mnt/Datos/Archivos
environment:
  - PROJECTS_DIRECTORY=/mnt/Datos/Archivos
```

> No montés como `/mnt/Datos/Archivos:/app/data/projects`. Arcane documenta que el path debe coincidir host ↔ contenedor.

## Desplegar en Arcane

1. Abrí Arcane → **Projects**
2. Debería aparecer `facutools` (escaneo recursivo bajo `PROJECTS_DIRECTORY`)
3. Abrí el proyecto, revisá `compose.yaml` / `.env`
4. **Deploy** / **Start** (el primer build tarda varios minutos)

UI: `http://<ip-del-nas>:8080` (o el puerto de `FACUTOOLS_HTTP_PORT`)

## Post-instalación

En FacuTools → **Settings**:

- **General** → `api_public_url`
- **Security** → nuevo `secret_key`
- Credenciales admin: logs del contenedor `facutools-backend`

HTTPS: poné NPM / Traefik delante del puerto del frontend.

## Actualizar

```bash
cd /mnt/Datos/Archivos/facutools
# Si trackeás con git en esa carpeta:
git pull
# O volvé a copiar backend/ y frontend/ desde un clone fresco
```

En Arcane → proyecto **facutools** → redeploy con rebuild.

## Por qué falla Dockge/Arcane con rutas absolutas

`context: /mnt/Datos/.../backend` solo funciona si Docker ve esa ruta en el host **y** el gestor la tiene montada. Con Arcane + rutas relativas (`./backend`) dentro del project folder, el build usa el directorio del proyecto (que ya está montado) y evita el error `path ... not found`.
