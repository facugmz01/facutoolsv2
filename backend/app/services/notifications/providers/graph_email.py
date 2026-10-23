from __future__ import annotations

import logging
from typing import Sequence

import httpx

from app.services.notifications.providers.base import DeliveryResult
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)

GRAPH_SCOPE = "https://graph.microsoft.com/.default"


async def _get_graph_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            token_url,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": GRAPH_SCOPE,
                "grant_type": "client_credentials",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError("Graph token response missing access_token")
        return token


async def send_graph_email(
    *,
    to_addrs: Sequence[str],
    subject: str,
    html_body: str,
    text_body: str,
    tenant_id: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    sender: str | None = None,
) -> DeliveryResult:
    tenant_id = tenant_id if tenant_id is not None else SettingsStore.get_str("graph_tenant_id")
    client_id = client_id if client_id is not None else SettingsStore.get_str("graph_client_id")
    client_secret = (
        client_secret if client_secret is not None else SettingsStore.get_str("graph_client_secret")
    )
    sender = sender if sender is not None else SettingsStore.get_str("graph_sender")

    recipients = [a.strip() for a in to_addrs if a and a.strip()]
    if not all([tenant_id, client_id, client_secret, sender]):
        return DeliveryResult(
            "email",
            False,
            "Graph/Entra settings incomplete (tenant, client, secret, sender)",
            skipped=True,
        )
    if not recipients:
        return DeliveryResult("email", False, "No email recipients configured", skipped=True)

    # Prefer HTML; Graph sendMail accepts a single body contentType.
    content = html_body or text_body
    content_type = "HTML" if html_body else "Text"

    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": content_type,
                "content": content,
            },
            "toRecipients": [{"emailAddress": {"address": addr}} for addr in recipients],
        },
        "saveToSentItems": False,
    }

    try:
        token = await _get_graph_token(tenant_id, client_id, client_secret)
        url = f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code >= 400:
                detail = resp.text[:500]
                logger.error("Graph sendMail failed: %s %s", resp.status_code, detail)
                return DeliveryResult("email", False, f"Graph {resp.status_code}: {detail}")
        return DeliveryResult("email", True, f"Sent via Graph to {len(recipients)} recipient(s)")
    except Exception as e:
        logger.exception("Graph sendMail failed")
        return DeliveryResult("email", False, str(e))
