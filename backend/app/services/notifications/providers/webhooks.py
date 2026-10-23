from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.notifications.providers.base import DeliveryResult, NotificationPayload
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)


async def send_generic_webhook(payload: NotificationPayload) -> DeliveryResult:
    url = SettingsStore.get_str("webhook_url")
    if not url:
        return DeliveryResult("webhook", False, "Webhook URL not configured", skipped=True)
    body = {
        "title": payload.title,
        "message": payload.message,
        "alert_type": payload.alert_type,
        "severity": payload.severity,
        "domain_name": payload.domain_name,
        "alert_id": payload.alert_id,
    }
    return await _post_json("webhook", url, body)


async def send_slack_webhook(payload: NotificationPayload) -> DeliveryResult:
    url = SettingsStore.get_str("slack_webhook_url")
    if not url:
        return DeliveryResult("slack", False, "Slack webhook URL not configured", skipped=True)
    color = {"critical": "#DC2626", "warning": "#D97706"}.get(payload.severity, "#0284C7")
    body = {
        "attachments": [
            {
                "color": color,
                "title": payload.title,
                "text": payload.message,
                "footer": f"{payload.alert_type} · {payload.domain_name or ''}".strip(" ·"),
            }
        ]
    }
    return await _post_json("slack", url, body)


async def send_discord_webhook(payload: NotificationPayload) -> DeliveryResult:
    url = SettingsStore.get_str("discord_webhook_url")
    if not url:
        return DeliveryResult("discord", False, "Discord webhook URL not configured", skipped=True)
    color = {"critical": 0xDC2626, "warning": 0xD97706}.get(payload.severity, 0x0284C7)
    body = {
        "embeds": [
            {
                "title": payload.title,
                "description": payload.message,
                "color": color,
                "footer": {"text": f"{payload.alert_type}" + (f" · {payload.domain_name}" if payload.domain_name else "")},
            }
        ]
    }
    return await _post_json("discord", url, body)


async def send_telegram(payload: NotificationPayload) -> DeliveryResult:
    token = SettingsStore.get_str("telegram_bot_token")
    chat_id = SettingsStore.get_str("telegram_chat_id")
    if not token or not chat_id:
        return DeliveryResult("telegram", False, "Telegram bot token/chat id not configured", skipped=True)
    text = f"*{payload.title}*\n{payload.message}"
    if payload.domain_name:
        text += f"\n_{payload.domain_name}_"
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    return await _post_json("telegram", url, body)


async def _post_json(channel: str, url: str, body: dict[str, Any]) -> DeliveryResult:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body)
            if resp.status_code >= 400:
                return DeliveryResult(channel, False, f"HTTP {resp.status_code}: {resp.text[:300]}")
        return DeliveryResult(channel, True, f"Delivered to {channel}")
    except Exception as e:
        logger.exception("%s delivery failed", channel)
        return DeliveryResult(channel, False, str(e))
