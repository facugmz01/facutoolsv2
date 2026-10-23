# FacuTools en CloudPanel — instalación desde la GUI

CloudPanel **no** tiene un botón “Instalar FacuTools” (eso solo existe para WordPress).  
Lo que sí podés hacer casi todo desde el panel:

1. Crear el sitio **Python** (dominio, puerto, SSL)
2. Subir archivos con el **File Manager**
3. Arrancar la app desde la **Terminal** del sitio (pocos comandos; no hace falta usar nuestros scripts)

Arquitectura: un solo sitio Python. Nginx de CloudPanel reenvía **todo** al puerto de la app.  
FastAPI sirve `/api/*` y también el frontend estático.

---

## Paso 1 — Crear sitio (GUI)

1. Entrá a CloudPanel → **Sites** → **Add Site**
2. Elegí **Create a Python Site**
3. Completá:

   | Campo | Valor |
   |-------|--------|
   | Domain Name | `facutools.tudominio.com` |
   | Python Version | `3.12` (o la más alta disponible; en Ubuntu 22.04 suele ser `3.10`) |
   | App Port | `8000` |
   | Site User / Password | los que quieras (anotalos) |

4. **Create**
5. En el sitio → **SSL/TLS** → emitir certificado **Let's Encrypt**

CloudPanel deja el código en:

```text
/home/SITEUSER/htdocs/DOMAIN/
```

Anotá `SITEUSER` y `DOMAIN` (aparecen en la ficha del sitio).

---

## Paso 2 — Paquete listo para subir

El zip ya está generado:

- En el repo: `deploy/cloudpanel/dist/facutools-cloudpanel.zip`
- En el Escritorio: `~/Desktop/facutools-cloudpanel.zip`

Incluye el backend + el frontend compilado en `static/` + carpeta `data/`.

Para regenerarlo más adelante:

```bash
# Desde la raíz del repo (requiere Docker o Node)
cd frontend && npm install && npm run build
mkdir -p ../backend/static && rsync -a --delete dist/ ../backend/static/
cd ../backend
zip -r ../deploy/cloudpanel/dist/facutools-cloudpanel.zip . \
  -x 'venv/*' -x '__pycache__/*' -x '*.db' -x 'data/*'
```

---

## Paso 3 — Subir archivos (GUI → File Manager)

1. Sites → tu dominio → **File Manager** (o el gestor de archivos del sitio)
2. Entrá a `htdocs/DOMAIN/` (o la carpeta raíz del sitio)
3. Creá/usá la carpeta de la app. Recomendado:

   ```text
   htdocs/DOMAIN/
   └── app/          ← acá va el contenido del zip (backend + static/)
       ├── app/
       ├── static/   ← build del frontend
       ├── requirements.txt
       └── data/     ← se crea después
   ```

4. Subí `facutools-cloudpanel.zip` y descomprimilo dentro de `app/`  
   (si el File Manager no descomprime, usá el Paso 4 con un solo comando `unzip`)

Estructura final esperada:

```text
.../htdocs/DOMAIN/app/
├── app/main.py
├── static/index.html
├── requirements.txt
└── data/            (vacía al inicio)
```

---

## Paso 4 — Entorno Python y arranque (Terminal del panel)

CloudPanel no inicia sola una app FastAPI custom. Desde **Sites → dominio → Terminal** (o SSH del Site User):

```bash
cd ~/htdocs/TU_DOMINIO/app
mkdir -p data
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Arranque en el puerto que configuraste en el sitio (8000)
export DATABASE_URL=postgresql+asyncpg://facutools:CHANGE_ME@127.0.0.1:5432/facutools
export FRONTEND_DIST=./static
nohup ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../uvicorn.log 2>&1 &
```

Comprobá:

```bash
curl -s http://127.0.0.1:8000/api/health
```

Debería devolver `{"status":"ok",...}`.

Abrí `https://TU_DOMINIO` en el navegador.

> Para que sobreviva un reinicio del VPS, más adelante conviene un servicio systemd (ver sección opcional abajo). Desde la GUI, `nohup` alcanza para probar.

---

## Paso 5 — Configurar FacuTools

1. Completá el bootstrap de admin (primera visita)
2. **Settings → General** → `api_public_url` = `https://TU_DOMINIO`
3. **Settings → Security** → nuevo `secret_key`

---

## Actualizar desde la GUI

1. En tu Mac: volver a hacer el zip del Paso 2
2. File Manager: reemplazá el contenido de `app/` (conservá la carpeta `data/`)
3. Terminal:

```bash
cd ~/htdocs/TU_DOMINIO/app
source venv/bin/activate
pip install -r requirements.txt
pkill -f 'uvicorn app.main:app' || true
export DATABASE_URL=postgresql+asyncpg://facutools:CHANGE_ME@127.0.0.1:5432/facutools
export FRONTEND_DIST=./static
nohup ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../uvicorn.log 2>&1 &
```

---

## Opcional — arranque automático (systemd)

Si querés que CloudPanel no dependa de `nohup`, como **root**:

```bash
# Ajustá SITEUSER, DOMAIN y rutas
cat > /etc/systemd/system/facutools.service << 'EOF'
[Unit]
Description=FacuTools
After=network.target

[Service]
User=SITEUSER
Group=SITEUSER
WorkingDirectory=/home/SITEUSER/htdocs/DOMAIN/app
Environment=DATABASE_URL=postgresql+asyncpg://facutools:CHANGE_ME@127.0.0.1:5432/facutools
Environment=FRONTEND_DIST=./static
ExecStart=/home/SITEUSER/htdocs/DOMAIN/app/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now facutools
```

---

## Qué hace la GUI vs qué no

| Desde la GUI de CloudPanel | Manual (Terminal / File Manager) |
|----------------------------|----------------------------------|
| Crear sitio Python | Subir el zip del backend+frontend |
| Dominio + SSL | `venv` + `pip install` |
| Puerto / reverse proxy nginx | Arrancar `uvicorn` |
| File Manager | Conservar `data/` en updates |

No hace falta tocar Vhost custom: el sitio Python ya proxya todo al App Port.

---

## Troubleshooting

| Síntoma | Qué revisar |
|---------|-------------|
| 502 Bad Gateway | ¿uvicorn está corriendo en el App Port? `curl 127.0.0.1:8000/api/health` |
| Solo JSON / sin UI | ¿existe `app/static/index.html`? ¿`FRONTEND_DIST=./static`? |
| Página en blanco | Rebuild del frontend y volver a subir `static/` |
| Se cae al reiniciar el VPS | Instalá el unit systemd de la sección opcional |

---

## Scripts (opcional / avanzado)

Si preferís automatizar por SSH, siguen existiendo:

- `scripts/install.sh`
- `scripts/deploy.sh`

Para el flujo que pediste (GUI), **no son necesarios**.
