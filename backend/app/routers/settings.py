from typing import Any, Dict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.settings_store import SettingsStore

router = APIRouter()


class SettingUpdate(BaseModel):
    value: Any


class SettingsBulkUpdate(BaseModel):
    settings: Dict[str, Any]


INTERVAL_KEYS = {"monitor_interval_minutes", "ssl_monitor_interval_minutes"}


def is_valid_timezone(name: Any) -> bool:
    if not isinstance(name, str) or not name.strip():
        return False
    try:
        ZoneInfo(name.strip())
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False
    return True


def _normalize_setting_value(key: str, value: Any) -> Any:
    if key == "timezone":
        if not is_valid_timezone(value):
            raise HTTPException(status_code=400, detail="timezone must be a valid IANA time zone")
        return value.strip()

    if key in INTERVAL_KEYS:
        try:
            minutes = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"{key} must be an integer") from None
        if minutes < 1:
            raise HTTPException(status_code=400, detail=f"{key} must be at least 1 minute")
        return minutes
    return value


@router.get("")
async def list_settings(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:read")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    return SettingsStore.all_with_meta()


@router.get("/grouped")
async def list_settings_grouped(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:read")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    return SettingsStore.by_category()


@router.get("/schedule")
async def get_schedule(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:read")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    from app.scheduler import get_schedule_status
    return get_schedule_status()


@router.get("/timezone")
async def get_timezone(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions()),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    value = SettingsStore.get_str("timezone", "UTC")
    return {"timezone": value if is_valid_timezone(value) else "UTC"}


@router.get("/{key}")
async def get_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:read")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    value = SettingsStore.get(key)
    if value is None and key not in SettingsStore._cache:
        raise HTTPException(status_code=404, detail="Setting not found")
    return {"key": key, "value": value}


@router.put("/{key}")
async def update_setting(
    key: str,
    body: SettingUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:write")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    try:
        result = await SettingsStore.set(db, key, _normalize_setting_value(key, body.value))
        from app.scheduler import get_schedule_status, reschedule_jobs
        reschedule_jobs()
        return {**result, "schedule": get_schedule_status()}
    except KeyError:
        raise HTTPException(status_code=404, detail="Setting not found")


@router.put("")
async def update_settings(
    body: SettingsBulkUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("settings:write")),
):
    if not SettingsStore._loaded:
        await SettingsStore.load(db)
    normalized = {
        key: _normalize_setting_value(key, value)
        for key, value in body.settings.items()
    }
    results = await SettingsStore.update_many(db, normalized)
    from app.scheduler import get_schedule_status, reschedule_jobs
    reschedule_jobs()
    return {"updated": results, "schedule": get_schedule_status()}
