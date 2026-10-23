from __future__ import annotations

from copy import deepcopy
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import async_session, get_db
from app.schemas import BulkImportRequest, DomainCreate, DomainResponse, DomainSetupRequest, DomainUpdate, DomainValidateRequest
from app.services.domain_service import DomainService, DomainSetupError

router = APIRouter()

_IDEMPOTENCY_STORE: dict[str, tuple[float, dict]] = {}
_IDEMPOTENCY_TTL_SECONDS = 600
_BULK_IMPORT_JOBS: dict[str, dict] = {}
_BULK_IMPORT_MAX_DOMAINS = 1000
_BULK_IMPORT_JOB_TTL_SECONDS = 3600


def _prune_idempotency_store() -> None:
    now = monotonic()
    expired = [key for key, (ts, _) in _IDEMPOTENCY_STORE.items() if now - ts > _IDEMPOTENCY_TTL_SECONDS]
    for key in expired:
        _IDEMPOTENCY_STORE.pop(key, None)


def _coerce_setup_error(exc: DomainSetupError) -> HTTPException:
    message = str(exc)
    if "ya está" in message.lower() or "already" in message.lower():
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _svc(db: AsyncSession, ctx: AuthContext) -> DomainService:
    return DomainService(db, organization_id=ctx.organization_id)


def _prune_bulk_import_jobs() -> None:
    now = monotonic()
    expired = [job_id for job_id, job in _BULK_IMPORT_JOBS.items() if now - job.get("updated_monotonic", now) > _BULK_IMPORT_JOB_TTL_SECONDS]
    for job_id in expired:
        _BULK_IMPORT_JOBS.pop(job_id, None)


async def _run_bulk_import_job(job_id: str, domains: list[DomainCreate], organization_id: int) -> None:
    job = _BULK_IMPORT_JOBS[job_id]
    job.update({"status": "running", "updated_monotonic": monotonic()})

    async def progress(summary: dict) -> None:
        job.update(summary)
        job["updated_monotonic"] = monotonic()

    try:
        async with async_session() as db:
            summary = await DomainService(db, organization_id=organization_id).bulk_import_summary(
                domains,
                progress=progress,
            )
        job.update(summary)
        job["status"] = "completed"
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
    finally:
        job["updated_monotonic"] = monotonic()


def _public_job(job: dict) -> dict:
    data = deepcopy(job)
    data.pop("updated_monotonic", None)
    return data


@router.get("", response_model=list[DomainResponse])
async def list_domains(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    return await _svc(db, ctx).list_domains()


@router.get("/stats")
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    return await _svc(db, ctx).get_dashboard_stats()


@router.get("/export/json")
async def export_domains(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    domains = await _svc(db, ctx).list_domains()
    return {"exported_at": __import__("datetime").datetime.utcnow().isoformat(), "domains": domains}


@router.post("/compare")
async def compare_domains(
    domain_names: list[str],
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    return await _svc(db, ctx).compare_domains(domain_names)


@router.post("/bulk-import")
async def bulk_import(
    data: BulkImportRequest,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    return await _svc(db, ctx).bulk_import(data.domains)


@router.post("/bulk-import/jobs", status_code=202)
async def start_bulk_import_job(
    data: BulkImportRequest,
    background_tasks: BackgroundTasks,
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    _prune_bulk_import_jobs()
    if len(data.domains) > _BULK_IMPORT_MAX_DOMAINS:
        raise HTTPException(status_code=413, detail=f"Máximo {_BULK_IMPORT_MAX_DOMAINS} dominios por lote")
    job_id = str(uuid4())
    _BULK_IMPORT_JOBS[job_id] = {
        "id": job_id,
        "status": "queued",
        "total": len(data.domains),
        "processed": 0,
        "created": 0,
        "skipped_existing": 0,
        "skipped_duplicates": 0,
        "invalid": 0,
        "invalid_items": [],
        "error": None,
        "updated_monotonic": monotonic(),
    }
    background_tasks.add_task(_run_bulk_import_job, job_id, data.domains, ctx.organization_id)
    return _public_job(_BULK_IMPORT_JOBS[job_id])


@router.get("/bulk-import/jobs/{job_id}")
async def get_bulk_import_job(
    job_id: str,
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    _prune_bulk_import_jobs()
    job = _BULK_IMPORT_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return _public_job(job)


@router.post("/validate")
async def validate_domain_name(
    data: DomainValidateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    return await _svc(db, ctx).validate_domain_name(data.name)


@router.get("/preview/{domain}")
async def preview_domain(
    domain: str,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    preview = await _svc(db, ctx).preview_domain(domain)
    if not preview:
        raise HTTPException(status_code=400, detail="Dominio inválido")
    return preview


@router.post("/setup", status_code=201)
async def setup_domain(
    data: DomainSetupRequest,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    legacy_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
):
    key = idempotency_key or legacy_idempotency_key
    if key:
        _prune_idempotency_store()
        cached = _IDEMPOTENCY_STORE.get(key)
        if cached is not None:
            return cached[1]

    try:
        result = await _svc(db, ctx).setup_domain(data)
        if key:
            _IDEMPOTENCY_STORE[key] = (monotonic(), result)
        return result
    except DomainSetupError as exc:
        raise _coerce_setup_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{domain_id}")
async def get_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    domain = await _svc(db, ctx).get_domain(domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    return domain


@router.post("", status_code=201)
async def create_domain(
    data: DomainCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    return await _svc(db, ctx).create_domain(data, owner_id=ctx.user.id)


@router.put("/{domain_id}")
async def update_domain(
    domain_id: int,
    data: DomainUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    domain = await _svc(db, ctx).update_domain(domain_id, data)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    return domain


@router.delete("/{domain_id}", status_code=204)
async def delete_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:delete")),
):
    if not await _svc(db, ctx).delete_domain(domain_id):
        raise HTTPException(status_code=404, detail="Domain not found")


@router.post("/{domain_id}/scan")
async def scan_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:write")),
):
    try:
        result = await _svc(db, ctx).scan_and_update(domain_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}") from exc
    if not result:
        raise HTTPException(status_code=404, detail="Domain not found")
    return result


@router.get("/{domain_id}/snapshots")
async def get_snapshots(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("domains:read")),
):
    return await _svc(db, ctx).get_snapshots(domain_id)
