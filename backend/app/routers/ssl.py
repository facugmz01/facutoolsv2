from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.models import SSLCertificate
from app.services.ssl_service import SSLService

router = APIRouter()


class SSLRequestBody(BaseModel):
    hostname: str
    domain_id: Optional[int] = None
    subdomain_id: Optional[int] = None
    challenge_type: str = "dns-01"
    auto_renew: bool = True
    wildcard: bool = False
    issuer_type: Literal["letsencrypt", "self_signed"] = "letsencrypt"
    validity_days: int = Field(default=365, ge=1, le=825)


def _svc(db: AsyncSession, ctx: AuthContext) -> SSLService:
    return SSLService(db, organization_id=ctx.organization_id)


@router.get("")
async def list_certificates(
    domain_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:read")),
):
    return await _svc(db, ctx).list_certificates(domain_id)


@router.get("/dashboard")
async def ssl_dashboard(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:read")),
):
    return await _svc(db, ctx).ssl_dashboard()


@router.get("/{cert_id}")
async def get_certificate(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:read")),
):
    cert = await _svc(db, ctx).get_certificate(cert_id)
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return cert


@router.get("/{cert_id}/history")
async def get_certificate_history(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:read")),
):
    if not await _svc(db, ctx).get_certificate(cert_id):
        raise HTTPException(status_code=404, detail="Certificate not found")
    return await _svc(db, ctx).get_history(cert_id)


@router.post("/check/{hostname}")
async def check_ssl(
    hostname: str,
    domain_id: Optional[int] = None,
    subdomain_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    return await _svc(db, ctx).check_hostname(hostname, domain_id, subdomain_id)


@router.post("/monitor-all")
async def monitor_all_ssl(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    return await _svc(db, ctx).monitor_all()


@router.post("/request")
async def request_certificate(
    body: SSLRequestBody,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    try:
        return await _svc(db, ctx).request_certificate(
            body.hostname,
            domain_id=body.domain_id,
            subdomain_id=body.subdomain_id,
            challenge_type=body.challenge_type,
            auto_renew=body.auto_renew,
            wildcard=body.wildcard,
            issuer_type=body.issuer_type,
            validity_days=body.validity_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{cert_id}/complete")
async def complete_certificate(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    if not await _svc(db, ctx).get_certificate(cert_id):
        raise HTTPException(status_code=404, detail="Certificate not found")
    result = await _svc(db, ctx).complete_certificate(cert_id)
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/{cert_id}/retry")
async def retry_validation(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    """Create a new ACME order (new DNS TXT) for a pending or failed certificate."""
    if not await _svc(db, ctx).get_certificate(cert_id):
        raise HTTPException(status_code=404, detail="Certificate not found")
    try:
        return await _svc(db, ctx).retry_validation(cert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{cert_id}/revoke")
async def revoke_certificate(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    if not await _svc(db, ctx).get_certificate(cert_id):
        raise HTTPException(status_code=404, detail="Certificate not found")
    try:
        return await _svc(db, ctx).revoke_certificate(cert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{cert_id}/renew")
async def renew_certificate(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    if not await _svc(db, ctx).get_certificate(cert_id):
        raise HTTPException(status_code=404, detail="Certificate not found")
    try:
        return await _svc(db, ctx).renew_certificate(cert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{cert_id}/download")
async def download_certificate(
    cert_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:download")),
):
    service = _svc(db, ctx)
    result = await db.execute(
        select(SSLCertificate).where(
            SSLCertificate.id == cert_id,
            SSLCertificate.organization_id == ctx.organization_id,
        )
    )
    cert_row = result.scalar_one_or_none()
    if not cert_row:
        raise HTTPException(status_code=404, detail="Certificate not found")
    try:
        data, filename = service.build_download_archive(cert_id, cert_row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/renew-expiring")
async def renew_expiring(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("ssl:write")),
):
    return await _svc(db, ctx).renew_expiring()
