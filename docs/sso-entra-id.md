# SSO con Microsoft Entra ID

FacuTools implementa SSO mediante OpenID Connect (OIDC). Puede crear automaticamente la aplicacion OIDC dentro del tenant de Entra despues de que un administrador conceda permisos de Microsoft Graph. Tambien conserva la configuracion manual para instalaciones que no quieran habilitar ese permiso.

## Requisitos previos

- Una URL publica HTTPS para la aplicacion. En desarrollo se puede usar `http://localhost`.
- Acceso de administrador a Microsoft Entra ID para registrar una aplicacion.
- Una cuenta de FacuTools con el permiso `sso:manage`.
- Docker Compose en ejecucion si el despliegue usa Docker.

El backend necesita Redis para almacenar el `state` de OIDC y las siguientes variables de proceso. No subas sus valores reales al repositorio:

```dotenv
SECRET_KEY=<secreto-aleatorio-de-produccion>
CLIENT_SECRET_ENCRYPTION_KEY=<clave-fernet-valida>
```

El archivo [`.env.example`](../.env.example) contiene la plantilla. Genera valores seguros, por ejemplo:

```bash
openssl rand -base64 48
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

Usa el primer valor como `SECRET_KEY` y el segundo como `CLIENT_SECRET_ENCRYPTION_KEY`. Reinicia el backend despues de cambiar cualquiera de los dos. No cambies la clave de cifrado mientras haya secretos SSO guardados: el cliente OIDC ya almacenado no podria descifrarse.

## Onboarding automatico del tenant

Esta opcion necesita una App Registration bootstrap de FacuTools, registrada una unica vez por quien opera esta instancia. No es posible crearla sin este paso: Entra exige que una aplicacion ya conocida solicite el consentimiento del administrador del tenant.

1. En **Microsoft Entra ID > App registrations**, creá `FacuTools Entra Onboarding`.
2. Elegí **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)**.
3. En **Authentication**, agregá como plataforma **Web** la URI `<api_public_url>/api/auth/sso/entra-onboarding/callback`.
4. En **API permissions**, agregá Microsoft Graph **Delegated** `Application.ReadWrite.All`. Requiere consentimiento administrativo.
5. En **Certificates & secrets**, creá un client secret y guardá su valor.
6. Copiá el Application (client) ID y el secreto en el `.env` de la instancia:

```dotenv
ENTRA_ONBOARDING_CLIENT_ID=<bootstrap-app-client-id>
ENTRA_ONBOARDING_CLIENT_SECRET=<bootstrap-app-client-secret>
```

7. Reiniciá el backend con `docker compose up -d --build`.

Un administrador del tenant destino debe tener un rol que permita crear App Registrations, como **Application Administrator** o **Cloud Application Administrator**. En **Configuracion > Seguridad > Microsoft Entra ID**, elegí el nombre, la politica de autoaprovisionamiento y **Conectar tenant de Entra**. Tras aceptar el consentimiento, FacuTools crea una aplicacion de tenant unico, su redirect URI fijo `<api_public_url>/api/auth/sso/callback` y un secreto; solo este ultimo se guarda cifrado en la base de datos.

El token de Graph otorgado por el administrador se usa una vez para crear la aplicacion y nunca se persiste. Si no querés habilitar `Application.ReadWrite.All` para la app bootstrap, usá el flujo manual que sigue.

## 1. Definir las URLs publicas

Elegí la URL que realmente recibe las solicitudes a la API. Si el proxy sirve frontend y API desde el mismo host, usa el origen sin `/api`.

| Despliegue | `cors_origins` | `api_public_url` | URI de redireccionamiento en Entra |
| --- | --- | --- | --- |
| Produccion en un mismo host | `["https://facutools.example.com"]` | `https://facutools.example.com` | `https://facutools.example.com/api/auth/sso/<provider_id>/callback` |
| API en host separado | `["https://app.example.com"]` | `https://api.example.com` | `https://api.example.com/api/auth/sso/<provider_id>/callback` |
| Desarrollo local con Docker | `["http://localhost:5173"]` | `http://localhost:8001` | `http://localhost:8001/api/auth/sso/<provider_id>/callback` |

En FacuTools, iniciá sesión como administrador y abrí **Configuracion > Seguridad**. Actualizá `CORS Origins` y `API Public URL` con los valores de la tabla. La URI incluye el identificador del proveedor, que se conoce despues de crearlo; por eso primero se registra la aplicacion con una URI temporal y luego se actualiza con la URI definitiva.

Para produccion, Entra exige HTTPS excepto para `localhost`. Confirmá tambien que el proxy no bloquee `GET /api/auth/sso/*/callback` ni elimine los parametros `code` y `state`.

## 2. Registrar la aplicacion en Entra

1. En el portal de Azure, abrí **Microsoft Entra ID > App registrations > New registration**.
2. Elegí un nombre, por ejemplo `FacuTools SSO`.
3. Para un unico tenant, elegí **Accounts in this organizational directory only**. Elegí una opcion multitenant solo si la instancia aceptara usuarios de otros tenants.
4. En **Redirect URI**, seleccioná **Web** e ingresá una URI temporal valida de la tabla anterior. Se reemplazara en el paso 4.
5. Creá el registro y copiá **Application (client) ID** y **Directory (tenant) ID**.
6. Abrí **Certificates & secrets > New client secret**, elegí una expiracion acorde a la politica de la organizacion y copiá el valor del secreto inmediatamente. Ese valor se muestra una sola vez.

No se requieren permisos de Microsoft Graph ni una API permission adicional para este login. Los scopes OIDC `openid`, `profile` y `email` son suficientes.

## 3. Crear el proveedor en FacuTools

En **Configuracion > Seguridad > SSO (OIDC)** agregá un proveedor con estos campos:

| Campo | Valor |
| --- | --- |
| Nombre | `Microsoft Entra ID` |
| Issuer URL | `https://login.microsoftonline.com/<tenant_id>/v2.0` |
| Client ID | Application (client) ID copiado de Entra |
| Client secret | Valor del secreto creado en Entra |
| Scopes | `openid profile email` |
| Auto-aprovisionar usuarios | Activarlo solo si los usuarios del tenant pueden crear cuentas en FacuTools |

Al guardar, FacuTools cifra el client secret con `CLIENT_SECRET_ENCRYPTION_KEY`. El proveedor aparece en la lista con su ID, por ejemplo `3`.

## 4. Finalizar el redirect URI

Volvé a **App registrations > FacuTools SSO > Authentication** y reemplazá la URI temporal por:

```text
<api_public_url>/api/auth/sso/<provider_id>/callback
```

Ejemplo si `api_public_url` es `https://facutools.example.com` y el ID del proveedor es `3`:

```text
https://facutools.example.com/api/auth/sso/3/callback
```

Guardá los cambios. La coincidencia debe ser exacta: protocolo, host, path, puerto y ausencia o presencia de barras importan.

## 5. Probar el acceso

1. Cerrá sesión o abrí una ventana privada.
2. En la pantalla de login elegí `Microsoft Entra ID`.
3. Completá el inicio de sesión con un usuario permitido del tenant.
4. Verificá que el usuario vuelva a FacuTools y tenga una membresia de la organizacion.

Si el autoaprovisionamiento esta desactivado, el usuario debe existir y pertenecer previamente a la organizacion. Si esta activado, FacuTools asigna el rol `Viewer` o el rol predeterminado elegido al crear el proveedor.

Entra puede no entregar el claim opcional `email` para cuentas corporativas. FacuTools usa `preferred_username` (normalmente el UPN) como respaldo para identificar a esos usuarios.

## Diagnostico

| Sintoma | Comprobacion |
| --- | --- |
| `AADSTS50011` | La redirect URI en Entra no coincide exactamente con `api_public_url` y el ID del proveedor. |
| `OIDC discovery failed` | Comprobá el tenant ID y que el backend pueda acceder a `login.microsoftonline.com`. |
| `oidc_exchange_failed` | Verificá Client ID, valor del client secret, la expiracion del secreto y la URI de redireccionamiento. |
| `email_required` | Confirmá los scopes. Para cuentas corporativas se usa `preferred_username`; si no existe, revisá las claims emitidas por la politica del tenant. |
| `expired_state` | Redis debe estar disponible y el navegador debe volver al mismo host publico que inicio el flujo. |

Para revisar el backend con Docker:

```bash
docker compose logs -f backend
```