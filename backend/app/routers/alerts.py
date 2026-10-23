from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.models import Alert, AlertRule
from app.schemas import AlertRuleCreate
from app.services.notifications import send_test_notification

router = APIRouter()


class NotificationTestRequest(BaseModel):
    channels: Optional[List[str]] = Field(
        default=None,
        description="Channels to test; defaults to configured default_notification_channels",
    )
    recipients: Optional[List[str]] = Field(
        default=None,
        description="Override email recipients for this test",
    )
    title: str = "DomainTools test notification"
    message: str = "This is a test alert from DomainTools notification settings."


@router.get("")
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    result = await db.execute(
        select(Alert)
        .where(Alert.organization_id == ctx.organization_id)
        .order_by(Alert.created_at.desc())
        .limit(100)
    )
    alerts = result.scalars().all()
    return [
        {
            "id": a.id, "domain_id": a.domain_id, "type": a.alert_type,
            "severity": a.severity, "title": a.title, "message": a.message,
            "channel": a.channel, "is_read": a.is_read, "created_at": a.created_at,
        }
        for a in alerts
    ]


@router.post("/test")
async def test_notification(
    body: NotificationTestRequest,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    results = await send_test_notification(
        channels=body.channels,
        recipients=body.recipients,
        title=body.title,
        message=body.message,
        db=db,
        organization_id=ctx.organization_id,
    )
    return {
        "ok": any(r.success and not r.skipped for r in results),
        "results": [
            {
                "channel": r.channel,
                "success": r.success,
                "skipped": r.skipped,
                "detail": r.detail,
            }
            for r in results
        ],
    }


@router.patch("/{alert_id}/read")
async def mark_read(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.organization_id == ctx.organization_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_read = True
    await db.commit()
    return {"ok": True}


@router.get("/rules")
async def list_rules(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:read")),
):
    result = await db.execute(
        select(AlertRule)
        .where(AlertRule.organization_id == ctx.organization_id)
        .order_by(AlertRule.created_at.desc())
    )
    rules = result.scalars().all()
    return [
        {
            "id": r.id, "name": r.name, "rule_type": r.rule_type,
            "condition": r.condition, "channels": r.channels,
            "is_active": r.is_active, "created_at": r.created_at,
        }
        for r in rules
    ]


@router.post("/rules", status_code=201)
async def create_rule(
    data: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("alerts:write")),
):
    rule = AlertRule(
        organization_id=ctx.organization_id,
        name=data.name,
        rule_type=data.rule_type,
        condition=data.condition,
        channels=data.channels,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "name": rule.name, "rule_type": rule.rule_type}
