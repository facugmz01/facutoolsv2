from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.services.subdomain_service import SubdomainService

router = APIRouter()


class SubdomainCreate(BaseModel):
    hostname: str
    ssl_monitor: bool = True
    ssl_auto_renew: bool = False
    notes: Optional[str] = None


class SubdomainBulkCreate(BaseModel):
    hostnames: List[str]


class SubdomainUpdate(BaseModel):
    is_active: Optional[bool] = None
    ssl_monitor: Optional[bool] = None
    ssl_auto_renew: Optional[bool] = None
    notes: Optional[str] = None


def _svc(db: AsyncSession, ctx: AuthContext) -> SubdomainService:
    return SubdomainService(db, organization_id=ctx.organization_id)


@router.get("/domain/{domain_id}")
async def list_subdomains(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:read")),
):
    return await _svc(db, ctx).list_by_domain(domain_id)


@router.post("/domain/{domain_id}")
async def create_subdomain(
    domain_id: int,
    body: SubdomainCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:write")),
):
    try:
        return await _svc(db, ctx).create(
            domain_id, body.hostname,
            ssl_monitor=body.ssl_monitor,
            ssl_auto_renew=body.ssl_auto_renew,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/domain/{domain_id}/bulk")
async def bulk_create_subdomains(
    domain_id: int,
    body: SubdomainBulkCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:write")),
):
    return await _svc(db, ctx).bulk_create(domain_id, body.hostnames)


@router.post("/domain/{domain_id}/discover")
async def discover_subdomains(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:write")),
):
    return await _svc(db, ctx).discover_and_sync(domain_id)


@router.get("/{subdomain_id}")
async def get_subdomain(
    subdomain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:read")),
):
    sub = await _svc(db, ctx).get_subdomain(subdomain_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subdomain not found")
    return sub


@router.post("/{subdomain_id}/scan")
async def scan_subdomain(
    subdomain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:write")),
):
    try:
        result = await _svc(db, ctx).scan_and_update(subdomain_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}") from exc
    if not result:
        raise HTTPException(status_code=404, detail="Subdomain not found")
    return result


@router.get("/{subdomain_id}/snapshots")
async def get_subdomain_snapshots(
    subdomain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:read")),
):
    if not await _svc(db, ctx).get_subdomain(subdomain_id):
        raise HTTPException(status_code=404, detail="Subdomain not found")
    return await _svc(db, ctx).get_snapshots(subdomain_id)


@router.put("/{subdomain_id}")
async def update_subdomain(
    subdomain_id: int,
    body: SubdomainUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:write")),
):
    result = await _svc(db, ctx).update(subdomain_id, **body.model_dump(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="Subdomain not found")
    return result


@router.delete("/{subdomain_id}", status_code=204)
async def delete_subdomain(
    subdomain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("subdomains:delete")),
):
    if not await _svc(db, ctx).get_subdomain(subdomain_id):
        raise HTTPException(status_code=404, detail="Subdomain not found")
    if not await _svc(db, ctx).delete(subdomain_id):
        raise HTTPException(status_code=404, detail="Subdomain not found")
