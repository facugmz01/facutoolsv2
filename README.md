# FacuTools

All-in-one domain portfolio management platform — a powerful alternative to Domain Locker with extended functionality.

**Version:** see root [`VERSION`](VERSION) and [`CHANGELOG.md`](CHANGELOG.md).

## Features

### Core (Domain Locker parity)
- Domain portfolio management with tags, notes, and cost tracking
- Auto-fetch WHOIS, DNS, and SSL data
- Renewal alerts and expiration timeline
- Health monitoring (uptime, response time, HTTP status codes)
- Change tracking with audit snapshots
- Dashboard with stats, charts, and analytics
- Bulk import/export
- Dark mode UI
- Background scheduled monitoring
- Multi-channel notification support

### Tools hub (`/tools`)
Unified catalog (Domain Analysis + DNS/WHOIS + Network/IP + Security + Utilities). Legacy `/herramientas` paths redirect here.

- **Domain Analysis** — full scan, SSL check, email security, tech stack, subdomain discovery, name ideas
- **DNS Checker / WHOIS·RDAP / Propagation** — records, registrar data, 21 global resolvers with latency
- **IP Lookup** — geolocation, ASN, threats and DNSBL blacklists
- **Port checker, MAC lookup, IP calculator**
- **Ransomware intel, SMTP tester, SSL converter, password generator**
- **Email Security Audit** — SPF, DKIM, DMARC analysis with scoring
- **Domain Comparison Tool** — side-by-side comparison of multiple domains
- **Watchlist** — track domains you want to acquire with target prices
- **Custom Alert Rules** — configurable alert engine
- **CLI Tool** — command-line interface for automation
- **REST API** — full API for integrations
- **Self-hostable** — Docker deployment ready

### SSL Monitoring & Generation
- Continuous SSL monitoring for all domains and subdomains
- Auto-discovery and tracking of subdomains
- SSL expiry alerts (30-day warning, 7-day critical)
- Let's Encrypt certificate generation via ACME DNS-01 challenge
- Automatic SSL renewal for managed certificates
- SSL check history and dashboard
- Manual subdomain management with per-subdomain SSL control

### Configuration
- All settings stored in the database (no `.env` required)
- Configurable via **Settings** page in the UI or `/api/settings` API
- Categories: General, Monitoring, SSL/ACME, Notifications, Security
- Scheduler intervals update automatically when settings change
- Product version from root `VERSION` (also exposed on `/api/health`)

## Quick Start

### VM / VPS (producción)

Instalación en una máquina virtual con PostgreSQL + nginx:

```bash
git clone <URL-DEL-REPO> && cd domaintools
bash deploy/vm/scripts/install.sh --port 80 --data /opt/facutools/data
```

Guía completa: [`deploy/vm/README.md`](deploy/vm/README.md)

### With Docker (desarrollo local)

```bash
docker compose up -d --build
```

Stack: **PostgreSQL 16** + FastAPI + Vite (dev).

- Frontend: http://localhost:5173
- Backend API: http://localhost:8001
- API docs: http://localhost:8001/docs
- Postgres: `localhost:5432` (user/db `facutools`, password default `facutools`)

Set `SECRET_KEY` and `CLIENT_SECRET_ENCRYPTION_KEY` in a `.env` next to `docker-compose.yml`; both are required for production. Redis is used for one-time OIDC state. Override credentials with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` there as well.

Para desarrollo sin Docker, el backend sigue aceptando SQLite si no definís `DATABASE_URL` (default `sqlite+aiosqlite:///./domaintools.db`).

### TrueNAS SCALE (production)

Para desplegar en un NAS con datos persistentes y frontend en nginx:

```bash
# Ver guía completa en deploy/truenas/README.md
cp deploy/truenas/.env.example /mnt/pool/apps/facutools/deploy/.env
# Editar POSTGRES_PASSWORD (obligatorio)
cd deploy/truenas && docker compose --env-file /mnt/pool/apps/facutools/deploy/.env up -d --build
```

- UI: `http://<nas>:8080` (puerto configurable)
- Persistencia: `FACUTOOLS_DATA/postgres` (PostgreSQL) + certificados ACME en `FACUTOOLS_DATA`

### CloudPanel (sin Docker, desde la GUI)

Creá un sitio **Python** en CloudPanel, subí el backend + build del frontend con el File Manager y arrancá uvicorn. Guía: [`deploy/cloudpanel/README.md`](deploy/cloudpanel/README.md)

### Manual Setup

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

### CLI

```bash
pip install httpx
# Login and export token
python cli/domaintools.py login admin@example.com 'your-password'
export DOMAINTOOLS_TOKEN=...   # printed by login

python cli/domaintools.py list
python cli/domaintools.py add example.com
python cli/domaintools.py scan example.com
python cli/domaintools.py stats
```

## Authentication & RBAC

FacuTools uses **JWT auth** with RBAC in a **single organization** (one shared portfolio).

1. On first launch, open the UI and **register** the bootstrap admin (creates the organization + Admin role).
2. Further users join via **Users → Invite** (or `/invite?token=...`).
3. Roles: system **Admin / Operator / Viewer**, plus custom roles with permission checkboxes.
4. Optional **OIDC SSO**: configure providers under Roles → SSO (set `api_public_url` in Settings for callbacks).
5. Change `secret_key` in Settings before production.

For Microsoft Entra ID, see [docs/sso-entra-id.md](docs/sso-entra-id.md).

Protected APIs expect:

- `Authorization: Bearer <access_token>`

Only these endpoints are unauthenticated (login flow and healthcheck): `/api/health`, `/api/auth/status`, `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, SSO authorize/callback.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Bootstrap first admin + org |
| POST | `/api/auth/login` | Email/password login |
| GET | `/api/auth/me` | Current user, orgs, permissions |
| GET | `/api/orgs/members` | List members |
| GET | `/api/roles` | List roles |
| GET | `/api/domains` | List domains (org-scoped) |
| POST | `/api/domains` | Add a domain |
| POST | `/api/domains/{id}/scan` | Full domain scan |
| GET | `/api/domains/stats` | Dashboard statistics |
| GET | `/api/tools/scan/{domain}` | Live domain scan |
| GET | `/api/tools/email-security/{domain}` | Email security audit |
| GET | `/api/tools/propagation/{domain}` | DNS propagation check |
| GET | `/api/tools/tech-stack/{domain}` | Technology detection |
| GET | `/api/tools/blacklists/{domain}` | Blacklist check |
| GET | `/api/tools/subdomains/{domain}` | Subdomain discovery |
| GET | `/api/alerts` | List alerts |
| GET | `/api/watchlist` | Domain watchlist |

## Tech Stack

- **Backend:** Python, FastAPI, SQLAlchemy, APScheduler
- **Frontend:** React, TypeScript, Tailwind CSS, Recharts
- **Database:** PostgreSQL 16 (Docker / production); SQLite opcional sin Docker
- **Deployment:** Docker Compose

## License

MIT
