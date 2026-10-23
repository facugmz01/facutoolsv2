from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.schemas import MonitorTargetCreate, MonitorTargetUpdate
from app.services.monitor_service import MonitoringService

router = APIRouter()
history_router = APIRouter(prefix="/api/monitors")


def _target_to_dict(target) -> dict:
    return {
        "id": target.id,
        "name": target.name,
        "check_type": target.check_type,
        "target": target.target,
        "port": target.port,
        "keyword": target.keyword,
        "soap_action": target.soap_action,
        "request_body": target.request_body,
        "interval_minutes": target.interval_minutes,
        "interval_seconds": target.interval_seconds or target.interval_minutes * 60,
        "warning_threshold_ms": target.warning_threshold_ms,
        "critical_threshold_ms": target.critical_threshold_ms,
        "is_active": target.is_active,
        "is_public": target.is_public,
        "created_at": target.created_at,
        "updated_at": target.updated_at,
    }


def _result_to_dict(result) -> dict:
    return {
        "id": result.id,
        "target_id": result.target_id,
        "is_up": result.is_up,
        "status_code": result.status_code,
        "response_time_ms": result.response_time_ms,
        "error_message": result.error_message,
        "checked_at": result.checked_at,
    }


def _incident_to_dict(incident) -> dict:
    return {
        "id": incident.id,
        "target_id": incident.target_id,
        "status": incident.status,
        "started_at": incident.started_at,
        "resolved_at": incident.resolved_at,
    }


def _log_to_dict(log) -> dict:
    return {
        "id": log.id,
        "monitor_id": log.monitor_id,
        "status": log.status,
        "response_time_ms": log.response_time_ms,
        "status_code": log.status_code,
        "error_detail": log.error_detail,
        "created_at": log.created_at,
    }


@router.get("")
async def list_targets(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:read")),
):
    service = MonitoringService(db, ctx.organization_id)
    targets = await service.list_targets()
    return [_target_to_dict(t) for t in targets]


@history_router.get("/{target_id}/history")
async def get_history(
    target_id: int,
    days: int = Query(default=7, ge=1, le=7),
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:read")),
):
    service = MonitoringService(db, ctx.organization_id)
    history = await service.history(target_id, days=days)
    if history is None:
        raise HTTPException(status_code=404, detail="Monitor not found")
    history["logs"] = [_log_to_dict(log) for log in history["logs"]]
    return history


@router.post("", status_code=201)
async def create_target(
    data: MonitorTargetCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:write")),
):
    service = MonitoringService(db, ctx.organization_id)
    try:
        target = await service.create_target(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _target_to_dict(target)


@router.patch("/{target_id}")
async def update_target(
    target_id: int,
    data: MonitorTargetUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:write")),
):
    service = MonitoringService(db, ctx.organization_id)
    try:
        target = await service.update_target(target_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return _target_to_dict(target)


@router.delete("/{target_id}", status_code=204)
async def delete_target(
    target_id: int = Path(gt=0),
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:write")),
):
    service = MonitoringService(db, ctx.organization_id)
    deleted = await service.delete_target(target_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Target not found")


@router.post("/{target_id}/run")
async def run_target_check(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:write")),
):
    service = MonitoringService(db, ctx.organization_id)
    result = await service.run_check_now(target_id)
    if not result:
        raise HTTPException(status_code=404, detail="Target not found")
    return _result_to_dict(result)


@router.get("/{target_id}/results")
async def list_target_results(
    target_id: int,
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:read")),
):
    service = MonitoringService(db, ctx.organization_id)
    if not await service.get_target(target_id):
        raise HTTPException(status_code=404, detail="Target not found")
    results = await service.list_results(target_id, limit=limit)
    return [_result_to_dict(r) for r in results]


@router.get("/{target_id}/uptime")
async def get_target_uptime(
    target_id: int,
    hours: int = Query(default=24, le=8760),
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:read")),
):
    service = MonitoringService(db, ctx.organization_id)
    if not await service.get_target(target_id):
        raise HTTPException(status_code=404, detail="Target not found")
    return await service.uptime_stats(target_id, hours=hours)


@router.get("/{target_id}/incidents")
async def list_target_incidents(
    target_id: int,
    limit: int = Query(default=50, le=500),
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("monitoring:read")),
):
    service = MonitoringService(db, ctx.organization_id)
    if not await service.get_target(target_id):
        raise HTTPException(status_code=404, detail="Target not found")
    incidents = await service.list_incidents(target_id, limit=limit)
    return [_incident_to_dict(i) for i in incidents]
