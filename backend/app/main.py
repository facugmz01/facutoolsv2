from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import APP_VERSION, FRONTEND_DIST
from app.auth.deps import require_permissions
from app.database import init_db
from app.routers import (
    alerts,
    auth,
    domains,
    monitoring,
    network,
    notification_templates,
    orgs,
    public_ip,
    roles,
    settings,
    ssl,
    sso,
    subdomains,
    tools,
    watchlist,
)
from app.scheduler import start_scheduler, stop_scheduler
from app.redis_store import close_redis, init_rate_limiter
from app.settings_store import SettingsStore


def _cors_origins():
    origins = SettingsStore.get("cors_origins") if SettingsStore._loaded else None
    if not origins:
        return ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]
    if isinstance(origins, str):
        return [origins]
    return list(origins)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_rate_limiter()
        await init_db()
        start_scheduler()
        yield
    finally:
        stop_scheduler()
        await close_redis()


app = FastAPI(
    title="FacuTools",
    version=APP_VERSION,
    description="All-in-one domain portfolio management with advanced monitoring, security, and analytics.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_ip.router, prefix="/api", tags=["Public IP"])
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(sso.router, prefix="/api/auth/sso", tags=["SSO"])
app.include_router(orgs.router, prefix="/api/orgs", tags=["Organizations"])
app.include_router(roles.router, prefix="/api/roles", tags=["Roles"])
app.include_router(domains.router, prefix="/api/domains", tags=["Domains"])
app.include_router(subdomains.router, prefix="/api/subdomains", tags=["Subdomains"])
app.include_router(ssl.router, prefix="/api/ssl", tags=["SSL"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(tools.router, prefix="/api/tools", tags=["Tools"])
app.include_router(network.router, prefix="/api/network", tags=["Network Tools"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(
    notification_templates.router,
    prefix="/api/notification-templates",
    tags=["Notification Templates"],
)
app.include_router(watchlist.router, prefix="/api/watchlist", tags=["Watchlist"])
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["Monitoring"])
app.include_router(monitoring.history_router, tags=["Monitor History"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/features", dependencies=[Depends(require_permissions())])
async def list_features():
    return {
        "core": [
            "Domain portfolio management",
            "Auto-fetch WHOIS, DNS, SSL data",
            "Tags, notes, and cost tracking",
            "Renewal alerts and timeline",
            "Health monitoring (uptime, ping, status codes)",
            "Change tracking and audit snapshots",
            "Dashboard with stats and analytics",
            "Bulk import/export",
            "Dark mode UI",
            "Database-backed configuration",
            "Single-organization RBAC",
            "JWT authentication with OIDC SSO",
        ],
        "advanced": [
            "DNS propagation checker across global resolvers",
            "Email security audit (SPF, DKIM, DMARC)",
            "Technology stack fingerprinting",
            "Blacklist/malware scanning",
            "Subdomain discovery and enumeration",
            "Domain comparison tool",
            "Custom alert rules engine",
            "Watchlist for domain acquisition",
            "Portfolio valuation and cost tracking",
            "Scheduled background monitoring",
            "Multi-channel notifications (email via SMTP or Entra Graph, Teams, webhook, Telegram, Slack, Discord)",
            "REST API for integrations",
            "Self-hostable with Docker",
            "SSL monitoring for domains and subdomains",
            "Let's Encrypt SSL certificate generation (ACME)",
            "Automatic SSL renewal",
        ],
        "network_tools": [
            "IP Lookup (geolocalización, ASN, amenazas)",
            "DNS Checker avanzado (10 tipos de registro + proveedores)",
            "WHOIS/RDAP con soporte .ar",
            "Propagación DNS en 21 servidores globales",
            "Blacklists extendidas (32 DNSBL + AbuseIPDB)",
            "MAC Lookup",
            "Generador de contraseñas",
            "Calculadora de subred IP",
            "Probador SMTP",
            "Convertidor SSL (PEM, DER, PKCS#7, PKCS#12)",
        ],
    }


def _mount_frontend() -> None:
    """Serve the React build from the same process (CloudPanel Python site)."""
    candidates: list[Path] = []
    if FRONTEND_DIST:
        candidates.append(Path(FRONTEND_DIST))
    backend_root = Path(__file__).resolve().parent.parent
    candidates.extend(
        [
            backend_root / "static",
            backend_root / "frontend_dist",
        ]
    )
    for dist in candidates:
        if dist.is_dir() and (dist / "index.html").is_file():
            app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")
            return


_mount_frontend()
