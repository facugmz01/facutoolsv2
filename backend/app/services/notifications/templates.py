from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from jinja2 import BaseLoader, Environment, FileSystemLoader, TemplateSyntaxError, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import NotificationTemplate

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "templates" / "notifications"

_env: Environment | None = None
_string_env: Environment | None = None

TEMPLATE_CHANNELS = ("email", "teams")
DEFAULT_ALERT_TYPE = "*"


def _get_env() -> Environment:
    global _env
    if _env is None:
        _env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=select_autoescape(["html", "xml"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        _env.filters["tojson"] = lambda value: json.dumps(value, ensure_ascii=False)
    return _env


def _get_string_env() -> Environment:
    global _string_env
    if _string_env is None:
        _string_env = Environment(
            loader=BaseLoader(),
            autoescape=select_autoescape(["html", "xml"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        _string_env.filters["tojson"] = lambda value: json.dumps(value, ensure_ascii=False)
    return _string_env


def render_template(relative_path: str, context: dict[str, Any]) -> str:
    template = _get_env().get_template(relative_path)
    return template.render(**context)


def render_string(source: str, context: dict[str, Any]) -> str:
    template = _get_string_env().from_string(source)
    return template.render(**context)


def build_alert_context(
    *,
    title: str,
    message: str,
    alert_type: str,
    severity: str,
    domain_name: str | None = None,
    app_name: str = "DomainTools",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    severity_colors = {
        "critical": "#DC2626",
        "warning": "#D97706",
        "info": "#0284C7",
    }
    ctx: dict[str, Any] = {
        "app_name": app_name,
        "title": title,
        "message": message,
        "alert_type": alert_type,
        "severity": severity,
        "severity_color": severity_colors.get(severity, "#0284C7"),
        "domain_name": domain_name or "",
    }
    if extra:
        ctx.update(extra)
    return ctx


def file_default_templates() -> dict[str, dict[str, str]]:
    """Built-in Jinja sources shipped with the app (used as fallback / seed)."""
    return {
        "email": {
            "subject_template": (TEMPLATES_DIR / "email" / "subject.txt").read_text(encoding="utf-8"),
            "body_html": (TEMPLATES_DIR / "email" / "alert.html").read_text(encoding="utf-8"),
            "body_text": (TEMPLATES_DIR / "email" / "alert.txt").read_text(encoding="utf-8"),
        },
        "teams": {
            "body_json": (TEMPLATES_DIR / "teams" / "alert.json.j2").read_text(encoding="utf-8"),
        },
    }


def render_email(
    context: dict[str, Any],
    *,
    template: NotificationTemplate | None = None,
) -> tuple[str, str, str]:
    """Return (subject, html_body, text_body). Prefers DB template fields when provided."""
    if template and template.channel == "email":
        subject = (
            render_string(template.subject_template, context).strip()
            if template.subject_template
            else render_template("email/subject.txt", context).strip()
        )
        html = (
            render_string(template.body_html, context)
            if template.body_html
            else render_template("email/alert.html", context)
        )
        text = (
            render_string(template.body_text, context)
            if template.body_text
            else render_template("email/alert.txt", context)
        )
        return subject, html, text
    subject = render_template("email/subject.txt", context).strip()
    html = render_template("email/alert.html", context)
    text = render_template("email/alert.txt", context)
    return subject, html, text


def render_teams_card(
    context: dict[str, Any],
    *,
    template: NotificationTemplate | None = None,
) -> dict[str, Any]:
    if template and template.channel == "teams" and template.body_json:
        raw = render_string(template.body_json, context)
    else:
        raw = render_template("teams/alert.json.j2", context)
    return json.loads(raw)


async def load_notification_template(
    db: AsyncSession,
    organization_id: int | None,
    channel: str,
    alert_type: str,
) -> NotificationTemplate | None:
    """Resolve active template: exact alert_type first, then channel default (*)."""
    if not organization_id:
        return None

    async def _find(atype: str) -> NotificationTemplate | None:
        result = await db.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.organization_id == organization_id,
                NotificationTemplate.channel == channel,
                NotificationTemplate.alert_type == atype,
                NotificationTemplate.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    match = await _find(alert_type)
    if match:
        return match
    if alert_type != DEFAULT_ALERT_TYPE:
        return await _find(DEFAULT_ALERT_TYPE)
    return None


def validate_template_syntax(
    *,
    channel: str,
    subject_template: Optional[str] = None,
    body_html: Optional[str] = None,
    body_text: Optional[str] = None,
    body_json: Optional[str] = None,
) -> None:
    """Raise ValueError on invalid Jinja / JSON template syntax."""
    env = _get_string_env()
    sample = build_alert_context(
        title="Sample",
        message="Sample message",
        alert_type="test",
        severity="info",
        domain_name="example.com",
    )
    try:
        if channel == "email":
            for label, src in (
                ("subject_template", subject_template),
                ("body_html", body_html),
                ("body_text", body_text),
            ):
                if src is None:
                    continue
                env.from_string(src).render(**sample)
        elif channel == "teams":
            if body_json is not None:
                rendered = env.from_string(body_json).render(**sample)
                json.loads(rendered)
        else:
            raise ValueError(f"Unsupported channel: {channel}")
    except TemplateSyntaxError as e:
        raise ValueError(f"Invalid Jinja syntax: {e}") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"Teams body_json must render to valid JSON: {e}") from e
