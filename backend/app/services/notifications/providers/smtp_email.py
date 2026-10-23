from __future__ import annotations

import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Sequence

import aiosmtplib

from app.services.notifications.providers.base import DeliveryResult
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)


def _resolve_security(security: str, port: int) -> tuple[bool, bool]:
    """Return (use_tls STARTTLS, use_ssl implicit)."""
    sec = (security or "auto").lower()
    if sec == "ssl" or (sec == "auto" and port == 465):
        return False, True
    if sec == "none":
        return False, False
    if sec in ("tls", "starttls") or sec == "auto":
        return True, False
    return True, False


async def send_smtp_email(
    *,
    to_addrs: Sequence[str],
    subject: str,
    html_body: str,
    text_body: str,
    host: str | None = None,
    port: int | None = None,
    user: str | None = None,
    password: str | None = None,
    mail_from: str | None = None,
    security: str | None = None,
    timeout: float | None = None,
) -> DeliveryResult:
    host = host if host is not None else SettingsStore.get_str("smtp_host")
    port = port if port is not None else SettingsStore.get_int("smtp_port", 587)
    user = user if user is not None else SettingsStore.get_str("smtp_user")
    password = password if password is not None else SettingsStore.get_str("smtp_password")
    mail_from = mail_from if mail_from is not None else SettingsStore.get_str("smtp_from")
    security = security if security is not None else SettingsStore.get_str("smtp_security", "tls")
    timeout = timeout if timeout is not None else float(SettingsStore.get_int("smtp_timeout", 30))

    recipients = [a.strip() for a in to_addrs if a and a.strip()]
    if not host:
        return DeliveryResult("email", False, "SMTP host not configured", skipped=True)
    if not mail_from:
        return DeliveryResult("email", False, "SMTP from address not configured", skipped=True)
    if not recipients:
        return DeliveryResult("email", False, "No email recipients configured", skipped=True)

    use_tls, use_ssl = _resolve_security(security, port)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=host,
            port=port,
            username=user or None,
            password=password or None,
            start_tls=use_tls,
            use_tls=use_ssl,
            timeout=timeout,
        )
        return DeliveryResult("email", True, f"Sent via SMTP to {len(recipients)} recipient(s)")
    except Exception as e:
        logger.exception("SMTP send failed")
        return DeliveryResult("email", False, str(e))
