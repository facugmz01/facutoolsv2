from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert
from app.services.notifications.dispatcher import dispatch_alert
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)


async def _is_duplicate(
    db: AsyncSession,
    *,
    organization_id: Optional[int],
    domain_id: Optional[int],
    alert_type: str,
) -> bool:
    hours = SettingsStore.get_int("notification_dedup_hours", 24)
    if hours <= 0:
        return False
    since = datetime.utcnow() - timedelta(hours=hours)
    filters = [
        Alert.alert_type == alert_type,
        Alert.created_at >= since,
    ]
    if domain_id is not None:
        filters.append(Alert.domain_id == domain_id)
    if organization_id is not None:
        filters.append(Alert.organization_id == organization_id)
    result = await db.execute(select(Alert.id).where(and_(*filters)).limit(1))
    return result.scalar_one_or_none() is not None


async def create_alert(
    db: AsyncSession,
    *,
    organization_id: Optional[int],
    domain_id: Optional[int],
    alert_type: str,
    severity: str,
    title: str,
    message: str,
    domain_name: Optional[str] = None,
    notify: bool = True,
    channel: str = "in_app",
    channels: Optional[list[str]] = None,
) -> Optional[Alert]:
    """
    Create an in-app Alert (with dedup) and optionally dispatch to external channels.

    Does not commit — caller owns the transaction. Dispatch runs after flush so alert.id exists.
    """
    if await _is_duplicate(
        db,
        organization_id=organization_id,
        domain_id=domain_id,
        alert_type=alert_type,
    ):
        logger.debug("Dedup skip alert type=%s domain_id=%s", alert_type, domain_id)
        return None

    alert = Alert(
        organization_id=organization_id,
        domain_id=domain_id,
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        channel=channel,
    )
    db.add(alert)
    await db.flush()

    if notify:
        try:
            await dispatch_alert(db, alert, domain_name=domain_name, channels=channels)
        except Exception:
            logger.exception("Failed to dispatch alert %s", alert.id)

    return alert
