from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class DeliveryResult:
    channel: str
    success: bool
    detail: str = ""
    skipped: bool = False


@dataclass
class NotificationPayload:
    title: str
    message: str
    alert_type: str
    severity: str = "info"
    domain_name: Optional[str] = None
    alert_id: Optional[int] = None
    extra: dict[str, Any] = field(default_factory=dict)
