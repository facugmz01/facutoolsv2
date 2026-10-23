from __future__ import annotations

import logging
from typing import Any, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, Domain, DomainNotificationPreference
from app.services.notifications.preferences import preference_allows
from app.services.notifications.providers.base import DeliveryResult, NotificationPayload
from app.services.notifications.providers.graph_email import send_graph_email
from app.services.notifications.providers.smtp_email import send_smtp_email
from app.services.notifications.providers.teams import send_teams_webhook
from app.services.notifications.providers.webhooks import (
    send_discord_webhook,
    send_generic_webhook,
    send_slack_webhook,
    send_telegram,
)
from app.services.notifications.templates import (
    build_alert_context,
    load_notification_template,
    render_email,
    render_teams_card,
)
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)

SUPPORTED_CHANNELS = ("email", "teams", "webhook", "slack", "discord", "telegram")


def _enabled_channels(override: Optional[Sequence[str]] = None) -> list[str]:
    if override is not None:
        channels = list(override)
    else:
        channels = SettingsStore.get_list("default_notification_channels", ["email", "teams"])
    return [c for c in channels if c in SUPPORTED_CHANNELS]


def _email_recipients(override: Optional[Sequence[str]] = None) -> list[str]:
    if override is not None:
        return [a.strip() for a in override if a and str(a).strip()]
    raw = SettingsStore.get("notification_email_to", [])
    if isinstance(raw, str):
        return [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
    if isinstance(raw, list):
        return [str(a).strip() for a in raw if str(a).strip()]
    return []


async def _load_domain_prefs(db: AsyncSession, domain_id: Optional[int]) -> Optional[dict]:
    if not domain_id:
        return None
    result = await db.execute(
        select(DomainNotificationPreference).where(DomainNotificationPreference.domain_id == domain_id)
    )
    pref = result.scalar_one_or_none()
    return pref.preferences if pref else None


async def _resolve_domain_name(db: AsyncSession, alert: Alert) -> Optional[str]:
    if alert.domain_id:
        result = await db.execute(select(Domain.name).where(Domain.id == alert.domain_id))
        name = result.scalar_one_or_none()
        if name:
            return name
    return None


async def dispatch_alert(
    db: AsyncSession,
    alert: Alert,
    *,
    domain_name: Optional[str] = None,
    channels: Optional[Sequence[str]] = None,
    recipients: Optional[Sequence[str]] = None,
    respect_preferences: bool = True,
) -> list[DeliveryResult]:
    """Deliver an existing Alert over configured external channels."""
    name = domain_name or await _resolve_domain_name(db, alert)
    prefs = await _load_domain_prefs(db, alert.domain_id) if respect_preferences else None

    if respect_preferences and not preference_allows(alert.alert_type, prefs):
        logger.info(
            "Skipping external notify for alert %s type=%s (domain prefs)",
            alert.id,
            alert.alert_type,
        )
        return [DeliveryResult("prefs", True, "Blocked by domain notification preferences", skipped=True)]

    payload = NotificationPayload(
        title=alert.title,
        message=alert.message,
        alert_type=alert.alert_type,
        severity=alert.severity,
        domain_name=name,
        alert_id=alert.id,
    )
    return await dispatch_payload(
        payload,
        channels=channels,
        recipients=recipients,
        db=db,
        organization_id=alert.organization_id,
    )


async def dispatch_payload(
    payload: NotificationPayload,
    *,
    channels: Optional[Sequence[str]] = None,
    recipients: Optional[Sequence[str]] = None,
    db: Optional[AsyncSession] = None,
    organization_id: Optional[int] = None,
) -> list[DeliveryResult]:
    app_name = SettingsStore.get_str("app_name", "DomainTools")
    context = build_alert_context(
        title=payload.title,
        message=payload.message,
        alert_type=payload.alert_type,
        severity=payload.severity,
        domain_name=payload.domain_name,
        app_name=app_name,
        extra=payload.extra,
    )

    email_tpl = None
    teams_tpl = None
    if db is not None and organization_id is not None:
        email_tpl = await load_notification_template(db, organization_id, "email", payload.alert_type)
        teams_tpl = await load_notification_template(db, organization_id, "teams", payload.alert_type)

    results: list[DeliveryResult] = []
    for channel in _enabled_channels(channels):
        try:
            if channel == "email":
                results.append(
                    await _send_email(
                        context,
                        recipients=_email_recipients(recipients),
                        template=email_tpl,
                    )
                )
            elif channel == "teams":
                card = render_teams_card(context, template=teams_tpl)
                results.append(await send_teams_webhook(card))
            elif channel == "webhook":
                results.append(await send_generic_webhook(payload))
            elif channel == "slack":
                results.append(await send_slack_webhook(payload))
            elif channel == "discord":
                results.append(await send_discord_webhook(payload))
            elif channel == "telegram":
                results.append(await send_telegram(payload))
        except Exception as e:
            logger.exception("Channel %s failed unexpectedly", channel)
            results.append(DeliveryResult(channel, False, str(e)))

    delivered = [r.channel for r in results if r.success and not r.skipped]
    if delivered:
        logger.info("Alert %s delivered via: %s", payload.alert_id, ", ".join(delivered))
    return results


async def _send_email(
    context: dict[str, Any],
    recipients: list[str],
    *,
    template=None,
) -> DeliveryResult:
    subject, html, text = render_email(context, template=template)
    provider = SettingsStore.get_str("email_provider", "smtp").lower()
    if provider == "graph":
        return await send_graph_email(
            to_addrs=recipients,
            subject=subject,
            html_body=html,
            text_body=text,
        )
    return await send_smtp_email(
        to_addrs=recipients,
        subject=subject,
        html_body=html,
        text_body=text,
    )


async def send_test_notification(
    *,
    channels: Optional[Sequence[str]] = None,
    recipients: Optional[Sequence[str]] = None,
    title: str = "DomainTools test notification",
    message: str = "This is a test alert from DomainTools notification settings.",
    db: Optional[AsyncSession] = None,
    organization_id: Optional[int] = None,
) -> list[DeliveryResult]:
    payload = NotificationPayload(
        title=title,
        message=message,
        alert_type="test",
        severity="info",
        domain_name="example.com",
    )
    # Test should hit requested channels even if prefs would block
    use_channels = list(channels) if channels else _enabled_channels()
    return await dispatch_payload(
        payload,
        channels=use_channels,
        recipients=recipients,
        db=db,
        organization_id=organization_id,
    )
