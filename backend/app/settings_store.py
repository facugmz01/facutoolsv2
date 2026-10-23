import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS: List[Dict[str, Any]] = [
    {"key": "app_name", "value": "FacuTools", "value_type": "string", "category": "general",
     "label": "App Name", "description": "Application display name"},
    {"key": "timezone", "value": "UTC", "value_type": "string", "category": "general",
     "label": "Time Zone", "description": "IANA time zone used to display dates and times across the system"},
    {"key": "monitor_interval_minutes", "value": "30", "value_type": "int", "category": "monitoring",
     "label": "Domain Monitor Interval", "description": "Minutes between domain health scans (minimum 1)"},
    {"key": "ssl_monitor_interval_minutes", "value": "60", "value_type": "int", "category": "monitoring",
     "label": "SSL Monitor Interval", "description": "Minutes between SSL certificate checks (minimum 1)"},
    {"key": "alert_rule_interval_minutes", "value": "5", "value_type": "int", "category": "monitoring",
     "label": "Alert Rule Interval", "description": "Minutes between custom alert rule evaluations (minimum 1)"},
    {"key": "ssl_expiry_warning_days", "value": "30", "value_type": "int", "category": "ssl",
     "label": "SSL Warning Days", "description": "Days before expiry to show warning"},
    {"key": "ssl_expiry_critical_days", "value": "7", "value_type": "int", "category": "ssl",
     "label": "SSL Critical Days", "description": "Days before expiry to show critical alert"},
    {"key": "acme_directory_url", "value": "https://acme-staging-v02.api.letsencrypt.org/directory",
     "value_type": "string", "category": "ssl",
     "label": "ACME Directory URL", "description": "Let's Encrypt ACME endpoint (use production URL in prod)"},
    {"key": "acme_email", "value": "", "value_type": "string", "category": "ssl",
     "label": "ACME Email", "description": "Real email for Let's Encrypt account (example.com addresses are rejected)"},
    {"key": "certs_storage_path", "value": "./data/certs", "value_type": "string", "category": "ssl",
     "label": "Certificates Path", "description": "Directory to store generated SSL certificates"},
    {"key": "cors_origins", "value": '["http://localhost:5173","http://localhost:3000"]',
     "value_type": "json", "category": "general",
     "label": "CORS Origins", "description": "Allowed frontend origins (JSON array)"},
    {"key": "default_notification_channels",
     "value": '["email","teams"]',
     "value_type": "json", "category": "notifications",
     "label": "Notification Channels",
     "description": "Enabled channels: email, teams, webhook, telegram, slack, discord (JSON array)"},
    {"key": "notification_email_to",
     "value": "[]", "value_type": "json", "category": "notifications",
     "label": "Notification Recipients",
     "description": "Email addresses that receive alert notifications (JSON array)"},
    {"key": "notification_dedup_hours",
     "value": "24", "value_type": "int", "category": "notifications",
     "label": "Alert Dedup Hours",
     "description": "Skip creating/sending the same alert type for a domain within this window"},
    {"key": "email_provider",
     "value": "smtp", "value_type": "string", "category": "notifications",
     "label": "Email Provider",
     "description": "How to send email notifications: smtp or graph"},
    {"key": "access_token_expire_minutes", "value": "60", "value_type": "int", "category": "security",
     "label": "Token Expiry (minutes)", "description": "Access token expiration in minutes"},
    {"key": "api_public_url", "value": "http://localhost:8000", "value_type": "string", "category": "security",
     "label": "API Public URL", "description": "Public base URL of the API (used for SSO callbacks)"},
    {"key": "telegram_bot_token", "value": "", "value_type": "string", "category": "notifications",
     "label": "Telegram Bot Token", "description": "Telegram bot token for alerts"},
    {"key": "telegram_chat_id", "value": "", "value_type": "string", "category": "notifications",
     "label": "Telegram Chat ID", "description": "Telegram chat ID for alerts"},
    {"key": "webhook_url", "value": "", "value_type": "string", "category": "notifications",
     "label": "Webhook URL", "description": "Webhook URL for alert notifications"},
    {"key": "slack_webhook_url", "value": "", "value_type": "string", "category": "notifications",
     "label": "Slack Webhook URL", "description": "Slack incoming webhook URL"},
    {"key": "discord_webhook_url", "value": "", "value_type": "string", "category": "notifications",
     "label": "Discord Webhook URL", "description": "Discord webhook URL for alerts"},
    {"key": "teams_webhook_url", "value": "", "value_type": "string", "category": "notifications",
     "label": "Teams Webhook URL",
     "description": "Microsoft Teams incoming webhook URL for Adaptive Card alerts"},
    {"key": "smtp_host", "value": "", "value_type": "string", "category": "notifications",
     "label": "SMTP Host", "description": "SMTP server for email notifications"},
    {"key": "smtp_port", "value": "587", "value_type": "int", "category": "notifications",
     "label": "SMTP Port", "description": "SMTP server port (587 STARTTLS, 465 SSL)"},
    {"key": "smtp_security", "value": "tls", "value_type": "string", "category": "notifications",
     "label": "SMTP Security",
     "description": "SMTP encryption: auto, tls (STARTTLS), ssl (implicit), or none"},
    {"key": "smtp_timeout", "value": "30", "value_type": "int", "category": "notifications",
     "label": "SMTP Timeout", "description": "SMTP connection timeout in seconds"},
    {"key": "smtp_user", "value": "", "value_type": "string", "category": "notifications",
     "label": "SMTP User", "description": "SMTP authentication username"},
    {"key": "smtp_password", "value": "", "value_type": "string", "category": "notifications",
     "label": "SMTP Password", "description": "SMTP authentication password"},
    {"key": "smtp_from", "value": "", "value_type": "string", "category": "notifications",
     "label": "SMTP From", "description": "From address for email notifications"},
    {"key": "graph_tenant_id", "value": "", "value_type": "string", "category": "notifications",
     "label": "Entra Tenant ID",
     "description": "Microsoft Entra ID (Azure AD) tenant ID for Graph mail"},
    {"key": "graph_client_id", "value": "", "value_type": "string", "category": "notifications",
     "label": "Entra App Client ID",
     "description": "Application (client) ID of the registered Entra app"},
    {"key": "graph_client_secret", "value": "", "value_type": "string", "category": "notifications",
     "label": "Entra App Client Secret",
     "description": "Client secret for the Entra app (Mail.Send application permission)"},
    {"key": "graph_sender", "value": "", "value_type": "string", "category": "notifications",
     "label": "Graph Sender Mailbox",
     "description": "UPN or email of the mailbox used with Graph sendMail"},
    {"key": "ipdata_api_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "ipdata.co API Key", "description": "Clave API para IP Lookup (geolocalización y amenazas)"},
    {"key": "abuseipdb_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "AbuseIPDB API Key",
     "description": "Clave para reputación IP en escaneo de blacklists (IPScope). Gratis en abuseipdb.com/register"},
    {"key": "spamrats_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "SpamRATS API Key",
     "description": "Clave para listas SpamRATS (DYNA/NoPTR/SPAM) en blacklists. Sin key se omiten. spamrats.com"},
    {"key": "spamhaus_dqs_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "Spamhaus DQS Key",
     "description": "Clave Data Query Service (gratis) para consultar Spamhaus ZEN/SBL/XBL/PBL sin bloqueo de resolvers públicos. docs.spamhaus.com"},
    {"key": "macvendors_api_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "MACVendors API Key", "description": "Clave opcional para MAC Lookup (fallback a API pública)"},
    {"key": "domscan_api_key", "value": "", "value_type": "string", "category": "integrations",
     "label": "DOMSCAN API Key", "description": "Clave opcional para failover WHOIS/RDAP"},
]


def _cast_value(raw: str, value_type: str) -> Any:
    if value_type == "int":
        return int(raw)
    if value_type == "bool":
        return raw.lower() in ("true", "1", "yes")
    if value_type == "json":
        return json.loads(raw)
    return raw


def _serialize_value(value: Any, value_type: str) -> str:
    if value_type == "json":
        return json.dumps(value)
    return str(value)


class SettingsStore:
    """In-memory cache of DB-backed application settings."""

    _cache: Dict[str, Any] = {}
    _meta: Dict[str, Dict[str, Any]] = {}
    _loaded: bool = False

    @classmethod
    async def load(cls, db: AsyncSession) -> None:
        await cls.seed_defaults(db)
        result = await db.execute(select(AppSetting))
        settings = result.scalars().all()
        cls._cache = {}
        cls._meta = {}
        for s in settings:
            if s.key == "secret_key":
                continue
            cls._cache[s.key] = _cast_value(s.value, s.value_type)
            cls._meta[s.key] = {
                "value_type": s.value_type,
                "category": s.category,
                "label": s.label,
                "description": s.description,
            }
        cls._loaded = True
        logger.info(f"Loaded {len(cls._cache)} settings from database")

    @classmethod
    async def seed_defaults(cls, db: AsyncSession) -> None:
        legacy_secret = await db.execute(select(AppSetting).where(AppSetting.key == "secret_key"))
        for setting in legacy_secret.scalars().all():
            await db.delete(setting)
        for default in DEFAULT_SETTINGS:
            existing = await db.execute(
                select(AppSetting).where(AppSetting.key == default["key"])
            )
            if not existing.scalar_one_or_none():
                db.add(AppSetting(**default))
        await db.commit()

    @classmethod
    def get(cls, key: str, default: Any = None) -> Any:
        return cls._cache.get(key, default)

    @classmethod
    def get_int(cls, key: str, default: int = 0) -> int:
        val = cls.get(key, default)
        return int(val) if val is not None else default

    @classmethod
    def get_str(cls, key: str, default: str = "") -> str:
        val = cls.get(key, default)
        return str(val) if val is not None else default

    @classmethod
    def get_list(cls, key: str, default: Optional[List] = None) -> List:
        val = cls.get(key, default or [])
        return val if isinstance(val, list) else (default or [])

    @classmethod
    def all(cls) -> Dict[str, Any]:
        return dict(cls._cache)

    @classmethod
    def all_with_meta(cls) -> List[Dict[str, Any]]:
        return [
            {
                "key": key,
                "value": cls._cache[key],
                "value_type": cls._meta.get(key, {}).get("value_type", "string"),
                "category": cls._meta.get(key, {}).get("category", "general"),
                "label": cls._meta.get(key, {}).get("label", key),
                "description": cls._meta.get(key, {}).get("description", ""),
            }
            for key in sorted(cls._cache.keys())
        ]

    @classmethod
    async def set(cls, db: AsyncSession, key: str, value: Any) -> Dict[str, Any]:
        result = await db.execute(select(AppSetting).where(AppSetting.key == key))
        setting = result.scalar_one_or_none()
        if not setting:
            raise KeyError(f"Unknown setting: {key}")

        setting.value = _serialize_value(value, setting.value_type)
        setting.updated_at = datetime.utcnow()
        cls._cache[key] = _cast_value(setting.value, setting.value_type)
        await db.commit()
        return {"key": key, "value": cls._cache[key]}

    @classmethod
    async def update_many(cls, db: AsyncSession, updates: Dict[str, Any]) -> List[Dict[str, Any]]:
        results = []
        for key, value in updates.items():
            try:
                results.append(await cls.set(db, key, value))
            except KeyError:
                logger.warning(f"Skipping unknown setting: {key}")
        return results

    @classmethod
    def by_category(cls) -> Dict[str, List[Dict[str, Any]]]:
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for item in cls.all_with_meta():
            cat = item["category"]
            grouped.setdefault(cat, []).append(item)
        return grouped
