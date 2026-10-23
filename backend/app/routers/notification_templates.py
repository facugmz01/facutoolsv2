from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.models import NotificationTemplate
from app.schemas import (
    NotificationTemplateCreate,
    NotificationTemplatePreviewRequest,
    NotificationTemplateUpdate,
)
from app.services.notifications.templates import (
    DEFAULT_ALERT_TYPE,
    TEMPLATE_CHANNELS,
    build_alert_context,
    file_default_templates,
    render_email,
    render_string,
    render_teams_card,
    validate_template_syntax,
)
from app.settings_store import SettingsStore

router = APIRouter()


def _serialize(t: NotificationTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "channel": t.channel,
        "alert_type": t.alert_type,
        "subject_template": t.subject_template,
        "body_html": t.body_html,
        "body_text": t.body_text,
        "body_json": t.body_json,
        "is_active": t.is_active,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _normalize_channel(channel: str) -> str:
    value = (channel or "").strip().lower()
    if value not in TEMPLATE_CHANNELS:
        raise HTTPException(
            status_code=400,
            detail=f"channel must be one of: {', '.join(TEMPLATE_CHANNELS)}",
        )
    return value


def _normalize_alert_type(alert_type: str | None) -> str:
    value = (alert_type or DEFAULT_ALERT_TYPE).strip() or DEFAULT_ALERT_TYPE
    return value


async def _get_owned(
    db: AsyncSession,
    template_id: int,
    organization_id: int,
) -> NotificationTemplate:
    result = await db.execute(
        select(NotificationTemplate).where(
            NotificationTemplate.id == template_id,
            NotificationTemplate.organization_id == organization_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")
    return item


@router.get("")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    result = await db.execute(
        select(NotificationTemplate)
        .where(NotificationTemplate.organization_id == ctx.organization_id)
        .order_by(NotificationTemplate.channel, NotificationTemplate.alert_type, NotificationTemplate.name)
    )
    return [_serialize(t) for t in result.scalars().all()]


@router.get("/defaults")
async def get_defaults(
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    """Return built-in file templates for the editor / seed UI."""
    _ = ctx
    defaults = file_default_templates()
    return {
        "channels": list(TEMPLATE_CHANNELS),
        "variables": [
            "app_name",
            "title",
            "message",
            "alert_type",
            "severity",
            "severity_color",
            "domain_name",
        ],
        "defaults": defaults,
    }


@router.post("/preview")
async def preview_template(
    data: NotificationTemplatePreviewRequest,
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    _ = ctx
    channel = _normalize_channel(data.channel)
    app_name = SettingsStore.get_str("app_name", "DomainTools")
    context = build_alert_context(
        title=data.title,
        message=data.message,
        alert_type=data.alert_type,
        severity=data.severity,
        domain_name=data.domain_name,
        app_name=app_name,
    )
    try:
        validate_template_syntax(
            channel=channel,
            subject_template=data.subject_template,
            body_html=data.body_html,
            body_text=data.body_text,
            body_json=data.body_json,
        )
        if channel == "email":
            # Temporary in-memory row shape for render_email
            tmp = NotificationTemplate(
                name="preview",
                channel="email",
                alert_type=data.alert_type,
                subject_template=data.subject_template,
                body_html=data.body_html,
                body_text=data.body_text,
            )
            subject, html, text = render_email(context, template=tmp)
            return {"channel": channel, "subject": subject, "html": html, "text": text}
        tmp = NotificationTemplate(
            name="preview",
            channel="teams",
            alert_type=data.alert_type,
            body_json=data.body_json,
        )
        card = render_teams_card(context, template=tmp)
        return {"channel": channel, "card": card, "raw": render_string(data.body_json or "", context)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Preview failed: {e}") from e


@router.post("/seed-defaults", status_code=201)
async def seed_defaults(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    """Create default email + teams templates if missing for alert_type=*."""
    defaults = file_default_templates()
    created: list[dict] = []
    for channel, fields in defaults.items():
        result = await db.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.organization_id == ctx.organization_id,
                NotificationTemplate.channel == channel,
                NotificationTemplate.alert_type == DEFAULT_ALERT_TYPE,
            )
        )
        if result.scalar_one_or_none():
            continue
        item = NotificationTemplate(
            organization_id=ctx.organization_id,
            name=f"Default {channel}",
            channel=channel,
            alert_type=DEFAULT_ALERT_TYPE,
            subject_template=fields.get("subject_template"),
            body_html=fields.get("body_html"),
            body_text=fields.get("body_text"),
            body_json=fields.get("body_json"),
            is_active=True,
        )
        db.add(item)
        created.append({"channel": channel, "alert_type": DEFAULT_ALERT_TYPE})
    await db.commit()
    return {"created": created, "count": len(created)}


@router.get("/{template_id}")
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    item = await _get_owned(db, template_id, ctx.organization_id)
    return _serialize(item)


@router.post("", status_code=201)
async def create_template(
    data: NotificationTemplateCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    channel = _normalize_channel(data.channel)
    alert_type = _normalize_alert_type(data.alert_type)
    try:
        validate_template_syntax(
            channel=channel,
            subject_template=data.subject_template,
            body_html=data.body_html,
            body_text=data.body_text,
            body_json=data.body_json,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    existing = await db.execute(
        select(NotificationTemplate).where(
            NotificationTemplate.organization_id == ctx.organization_id,
            NotificationTemplate.channel == channel,
            NotificationTemplate.alert_type == alert_type,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"A template for channel={channel} alert_type={alert_type} already exists",
        )

    item = NotificationTemplate(
        organization_id=ctx.organization_id,
        name=data.name.strip(),
        channel=channel,
        alert_type=alert_type,
        subject_template=data.subject_template,
        body_html=data.body_html,
        body_text=data.body_text,
        body_json=data.body_json,
        is_active=data.is_active,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _serialize(item)


@router.patch("/{template_id}")
async def update_template(
    template_id: int,
    data: NotificationTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    item = await _get_owned(db, template_id, ctx.organization_id)
    payload = data.model_dump(exclude_unset=True)

    if "channel" in payload:
        payload["channel"] = _normalize_channel(payload["channel"])
    if "alert_type" in payload:
        payload["alert_type"] = _normalize_alert_type(payload["alert_type"])
    if "name" in payload and payload["name"] is not None:
        payload["name"] = str(payload["name"]).strip()

    channel = payload.get("channel", item.channel)
    subject = payload.get("subject_template", item.subject_template)
    body_html = payload.get("body_html", item.body_html)
    body_text = payload.get("body_text", item.body_text)
    body_json = payload.get("body_json", item.body_json)
    try:
        validate_template_syntax(
            channel=channel,
            subject_template=subject,
            body_html=body_html,
            body_text=body_text,
            body_json=body_json,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    new_channel = payload.get("channel", item.channel)
    new_alert_type = payload.get("alert_type", item.alert_type)
    if new_channel != item.channel or new_alert_type != item.alert_type:
        clash = await db.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.organization_id == ctx.organization_id,
                NotificationTemplate.channel == new_channel,
                NotificationTemplate.alert_type == new_alert_type,
                NotificationTemplate.id != item.id,
            )
        )
        if clash.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"A template for channel={new_channel} alert_type={new_alert_type} already exists",
            )

    for key, value in payload.items():
        setattr(item, key, value)
    item.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return _serialize(item)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    item = await _get_owned(db, template_id, ctx.organization_id)
    await db.delete(item)
    await db.commit()
