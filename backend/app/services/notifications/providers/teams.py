from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.notifications.providers.base import DeliveryResult
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)


async def send_teams_webhook(
    card: dict[str, Any],
    *,
    webhook_url: str | None = None,
) -> DeliveryResult:
    url = webhook_url if webhook_url is not None else SettingsStore.get_str("teams_webhook_url")
    if not url:
        return DeliveryResult("teams", False, "Teams webhook URL not configured", skipped=True)

    payload = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": None,
                "content": card,
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code >= 400:
                detail = resp.text[:500]
                logger.error("Teams webhook failed: %s %s", resp.status_code, detail)
                return DeliveryResult("teams", False, f"HTTP {resp.status_code}: {detail}")
        return DeliveryResult("teams", True, "Adaptive Card posted to Teams")
    except Exception as e:
        logger.exception("Teams webhook failed")
        return DeliveryResult("teams", False, str(e))
