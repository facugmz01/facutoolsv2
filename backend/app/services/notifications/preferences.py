"""Map alert types to domain notification preference keys."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from app.utils.domain_validation import DEFAULT_NOTIFICATIONS

# alert_type (created by scanners) → preference id (wizard / DomainNotificationPreference)
ALERT_TYPE_TO_PREF: dict[str, str] = {
    "renewal": "expiring_soon",
    "ssl_expiry": "ssl_expiry",
    "downtime": "host_change",
    "blacklist": "security_change",
    "abuseipdb": "security_change",
    "threat": "security_change",
    "email_security": "security_change",
}


def preference_allows(alert_type: str, preferences: Optional[Mapping[str, Any]]) -> bool:
    """Return True if domain prefs allow external delivery for this alert type."""
    pref_key = ALERT_TYPE_TO_PREF.get(alert_type)
    if not pref_key:
        # Unknown types: allow (still gated by enabled channels)
        return True
    prefs = {**DEFAULT_NOTIFICATIONS, **(preferences or {})}
    return bool(prefs.get(pref_key, False))
