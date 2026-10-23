# FacuTools en Coolify (TrueNAS)

Coolify simplifica el despliegue respecto al asistente nativo de TrueNAS: conectás el repo Git, elegís **Docker Compose**, asignás un dominio y Coolify se encarga del build, HTTPS y redeploys.

## Por qué es más fácil que TrueNAS directo

| | TrueNAS (Custom App) | Coolify en TrueNAS |
|--|----------------------|---------------------|
| Multi-contenedor | Requiere "Install via YAML" o SSH | Nativo con Docker Compose |
| Build desde código | Rutas absolutas en el NAS | Clona el repo y build automático |
| HTTPS | Proxy manual | Let's Encrypt integrado |
| Variables de entorno | `.env` limitado en YAML | UI de Coolify |
| Actualizaciones | `git pull` + rebuild manual | Push a Git → redeploy |
| UI de gestión | Solo contenedores | Logs, dominios, env, rollback |

## Requisitos

1. **Coolify** instalado en TrueNAS (como Custom App o vía compose; una sola vez).
2. Repositorio Git con FacuTools (público o privado con GitHub App / Deploy Key).
3. Dominio apuntando al NAS (o wildcard `*.tudominio.com` en Coolify).

## Instalación (5 minutos)

### 1. Crear proyecto en Coolify

1. **Projects** → **+ Add** → nombre `FacuTools`.
2. **+ New Resource** → **Public Repository** (o Private / GitHub App).
3. Pegá la URL del repo y elegí la rama (`main`).

### 2. Build Pack

1. Cambiá el build pack de Nixpacks a **Docker Compose**.
2. Configurá:

   | Campo | Valor |
   |-------|-------|
   | Base Directory | `/` |
   | Docker Compose Location | `/deploy/coolify/docker-compose.yml` |

3. **Save**.

### 3. Dominio

1. En la lista de servicios del compose, abrí **frontend**.
2. Asigná el dominio, ej. `https://facutools.tudominio.com`.
3. El frontend escucha en el **puerto 80** del contenedor; no hace falta mapear puertos en el host.
4. **No** asignes dominio al servicio `backend` (es interno).

### 4. Deploy

1. **Deploy**.
2. La primera vez tarda varios minutos (build de backend + frontend).
3. Abrí la URL asignada.

### 5. Post-instalación

En la UI de FacuTools → **Settings**:

- **General** → `api_public_url` = `https://facutools.tudominio.com`
- **Security** → generar un `secret_key` nuevo

Revisá los logs del contenedor `backend` en Coolify para ver el usuario admin del bootstrap.

## Variables de entorno (obligatorias)

En Coolify → Environment Variables:

| Variable | Ejemplo | Notas |
|----------|---------|--------|
| `POSTGRES_PASSWORD` | secreto fuerte | **Obligatorio** |
| `POSTGRES_USER` | `facutools` | Opcional |
| `POSTGRES_DB` | `facutools` | Opcional |

## Persistencia

- `facutools-pgdata` — datos de **PostgreSQL**
- `facutools-data` — certificados ACME y archivos del backend

No se pierden en redeploys normales. Para backup:

```bash
docker volume ls | grep facutools
# Respaldo recomendado: pg_dump del servicio db + volumen de certificados
```

## Actualizar

1. Push a la rama conectada en Coolify, **o**
2. **Redeploy** manual desde el panel de Coolify.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| 502 Bad Gateway | Esperar a que termine el healthcheck del backend; revisar logs |
| API no responde | Verificar que nginx proxyea a `backend:8000` (nombre del servicio en compose) |
| SSO / redirects rotos | Configurar `api_public_url` con la URL HTTPS real |
| Build falla en frontend | Revisar logs de build; `Dockerfile.prod` usa `npm install` |

## Coolify vs TrueNAS nativo

- **Usá Coolify** si ya lo tenés o querés Git + HTTPS + UI sin tocar SSH.
- **Usá TrueNAS directo** (`deploy/truenas/`) si preferís cero dependencias extra y un solo stack en el NAS.
