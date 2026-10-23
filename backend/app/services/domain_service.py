from __future__ import annotations

from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Alert, Domain, DomainNotificationPreference, DomainSnapshot, HealthCheck, Subdomain
from app.schemas import DashboardStats, DomainCreate, DomainSetupRequest, DomainUpdate
from app.services.domain_scanner import check_health, full_domain_scan
from app.services.notifications import create_alert
from app.utils.domain_validation import (
    DEFAULT_NOTIFICATIONS,
    normalize_subdomain,
    validate_domain,
)


_PREVIEW_CACHE_TTL_SECONDS = 300
_PREVIEW_CACHE: dict[str, tuple[float, dict]] = {}


def _prune_preview_cache(now: float | None = None) -> None:
    current = monotonic() if now is None else now
    expired = [key for key, (ts, _) in _PREVIEW_CACHE.items() if current - ts > _PREVIEW_CACHE_TTL_SECONDS]
    for key in expired:
        _PREVIEW_CACHE.pop(key, None)


def _invalidate_preview_cache(domain_name: str) -> None:
    cache_key = domain_name.strip().lower().rstrip(".")
    _PREVIEW_CACHE.pop(cache_key, None)


class DomainSetupError(ValueError):
    """Raised when a domain setup request cannot be completed safely."""


class DomainService:
    def __init__(self, db: AsyncSession, organization_id: int | None = None):
        self.db = db
        self.organization_id = organization_id

    def _org_filter(self, query):
        if self.organization_id is not None:
            return query.where(Domain.organization_id == self.organization_id)
        return query

    def _normalize_subdomains(self, domain_name: str, raw_hostnames: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_hostname in raw_hostnames or []:
            hostname = normalize_subdomain(raw_hostname, domain_name)
            if not hostname or hostname in seen:
                continue
            seen.add(hostname)
            normalized.append(hostname)
        return normalized

    async def list_domains(self) -> list[dict]:
        q = select(Domain).options(selectinload(Domain.health_checks)).order_by(Domain.name)
        q = self._org_filter(q)
        result = await self.db.execute(q)
        domains = result.scalars().all()
        responses = []
        for d in domains:
            health = max(d.health_checks, key=lambda h: h.checked_at, default=None) if d.health_checks else None
            responses.append(_domain_to_response(d, health))
        return responses

    async def get_domain(self, domain_id: int) -> dict | None:
        q = select(Domain).options(selectinload(Domain.health_checks)).where(Domain.id == domain_id)
        q = self._org_filter(q)
        result = await self.db.execute(q)
        domain = result.scalar_one_or_none()
        if not domain:
            return None
        health = max(domain.health_checks, key=lambda h: h.checked_at, default=None) if domain.health_checks else None
        return _domain_to_response(domain, health)

    async def create_domain(self, data: DomainCreate, owner_id: int | None = None) -> dict:
        expires_at = _normalize_datetime(data.expires_at)
        domain = Domain(
            organization_id=self.organization_id,
            name=data.name.lower().strip(),
            registrar=data.registrar,
            purchase_price=data.purchase_price,
            renewal_cost=data.renewal_cost,
            estimated_value=data.estimated_value,
            expires_at=expires_at,
            auto_renew=data.auto_renew,
            notes=data.notes,
            tags=_tags_to_str(data.tags),
            owner_id=owner_id,
        )
        self.db.add(domain)
        await self.db.commit()
        await self.db.refresh(domain)
        return _domain_to_response(domain)

    async def update_domain(self, domain_id: int, data: DomainUpdate) -> dict | None:
        q = self._org_filter(select(Domain).where(Domain.id == domain_id))
        result = await self.db.execute(q)
        domain = result.scalar_one_or_none()
        if not domain:
            return None
        update_data = data.model_dump(exclude_unset=True)
        if "tags" in update_data and update_data["tags"] is not None:
            update_data["tags"] = _tags_to_str(update_data["tags"])
        if "expires_at" in update_data and update_data["expires_at"] is not None:
            update_data["expires_at"] = _normalize_datetime(update_data["expires_at"])
        for key, value in update_data.items():
            setattr(domain, key, value)
        domain.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(domain)
        return _domain_to_response(domain)

    async def delete_domain(self, domain_id: int) -> bool:
        q = self._org_filter(select(Domain).where(Domain.id == domain_id))
        result = await self.db.execute(q)
        domain = result.scalar_one_or_none()
        if not domain:
            return False
        await self.db.delete(domain)
        await self.db.commit()
        return True

    async def bulk_import(self, domains: list[DomainCreate]) -> list[dict]:
        created = []
        for data in domains:
            valid, _, normalized = validate_domain(data.name)
            if not valid:
                continue
            q = select(Domain).where(Domain.name == normalized)
            q = self._org_filter(q)
            existing = await self.db.execute(q)
            if existing.scalar_one_or_none():
                continue
            data.name = normalized
            created.append(await self.create_domain(data))
        return created

    async def bulk_import_summary(
        self,
        domains: list[DomainCreate],
        chunk_size: int = 100,
        progress: Callable[[dict], Awaitable[None]] | None = None,
    ) -> dict:
        total = len(domains)
        invalid_items: list[dict] = []
        skipped_duplicates = 0
        seen: set[str] = set()
        valid_items: list[tuple[str, DomainCreate]] = []

        for data in domains:
            valid, error, normalized = validate_domain(data.name)
            if not valid:
                invalid_items.append({"name": data.name, "error": error})
                continue
            if normalized in seen:
                skipped_duplicates += 1
                continue
            seen.add(normalized)
            data.name = normalized
            valid_items.append((normalized, data))

        summary = {
            "total": total,
            "processed": 0,
            "created": 0,
            "skipped_existing": 0,
            "skipped_duplicates": skipped_duplicates,
            "invalid": len(invalid_items),
            "invalid_items": invalid_items[:50],
        }

        async def notify() -> None:
            if progress:
                await progress(dict(summary))

        await notify()

        for start in range(0, len(valid_items), chunk_size):
            chunk = valid_items[start:start + chunk_size]
            names = [name for name, _ in chunk]
            q = select(Domain.name).where(Domain.name.in_(names))
            q = self._org_filter(q)
            existing_names = set((await self.db.execute(q)).scalars().all())

            for normalized, data in chunk:
                if normalized in existing_names:
                    summary["skipped_existing"] += 1
                    continue
                self.db.add(Domain(
                    organization_id=self.organization_id,
                    name=normalized,
                    registrar=data.registrar,
                    purchase_price=data.purchase_price,
                    renewal_cost=data.renewal_cost,
                    estimated_value=data.estimated_value,
                    expires_at=_normalize_datetime(data.expires_at),
                    auto_renew=data.auto_renew,
                    notes=data.notes,
                    tags=_tags_to_str(data.tags),
                ))
                summary["created"] += 1

            await self.db.commit()
            summary["processed"] += len(chunk)
            await notify()

        summary["processed"] += summary["invalid"] + summary["skipped_duplicates"]
        await notify()
        return summary

    async def validate_domain_name(self, name: str) -> dict:
        valid, error, normalized = validate_domain(name)
        if not valid:
            return {"valid": False, "normalized": normalized, "available": False, "error": error}

        q = select(Domain).where(Domain.name == normalized)
        q = self._org_filter(q)
        existing = await self.db.execute(q)
        available = existing.scalar_one_or_none() is None
        return {
            "valid": True,
            "normalized": normalized,
            "available": available,
            "error": None if available else "Este dominio ya está en tu portfolio",
        }

    def _serialize_scan(self, scan: dict) -> dict:
        return {key: _serialize_value(value) for key, value in scan.items()}

    async def preview_domain(self, name: str) -> dict | None:
        valid, error, normalized = validate_domain(name)
        if not valid:
            return None

        now = monotonic()
        _prune_preview_cache(now)

        cache_key = normalized.lower()
        cached = _PREVIEW_CACHE.get(cache_key)
        if cached is not None and now - cached[0] < _PREVIEW_CACHE_TTL_SECONDS:
            return cached[1]

        scan = await full_domain_scan(normalized)
        serialized = self._serialize_scan(scan)
        whois = serialized.get("whois") or {}
        result = {
            "domain": normalized,
            "registrar": whois.get("registrar"),
            "expires_at": whois.get("expiration_date"),
            "whois": whois,
            "details": serialized,
        }
        _PREVIEW_CACHE[cache_key] = (now, result)
        return result

    async def setup_domain(self, data: DomainSetupRequest) -> dict | None:
        valid, error, normalized = validate_domain(data.name)
        if not valid:
            raise DomainSetupError(error or "Dominio inválido")

        q = select(Domain).where(Domain.name == normalized)
        q = self._org_filter(q)
        existing = await self.db.execute(q)
        if existing.scalar_one_or_none():
            raise DomainSetupError("Este dominio ya está en tu portfolio")

        health = await check_health(normalized)

        try:
            domain = Domain(
                organization_id=self.organization_id,
                name=normalized,
                registrar=data.registrar,
                renewal_cost=data.renewal_cost,
                expires_at=_normalize_datetime(data.expires_at),
                notes=data.notes,
                tags=_tags_to_str(data.tags),
            )
            self.db.add(domain)
            await self.db.flush()

            health_check = HealthCheck(
                domain_id=domain.id,
                is_up=health["is_up"],
                status_code=health["status_code"],
                response_time_ms=health["response_time_ms"],
            )
            self.db.add(health_check)

            prefs = {**DEFAULT_NOTIFICATIONS, **data.notifications.preferences}
            notification = DomainNotificationPreference(
                domain_id=domain.id,
                preferences=prefs,
                include_subdomains=data.notifications.include_subdomains,
            )
            self.db.add(notification)

            seen_hostnames: set[str] = set()
            for hostname in self._normalize_subdomains(normalized, data.subdomains):
                if hostname in seen_hostnames:
                    continue
                seen_hostnames.add(hostname)

                existing_sub = await self.db.execute(select(Subdomain).where(Subdomain.hostname == hostname))
                if existing_sub.scalar_one_or_none():
                    continue

                sub = Subdomain(
                    domain_id=domain.id,
                    hostname=hostname,
                    auto_discovered=False,
                    ssl_monitor=True,
                )
                self.db.add(sub)

            await self.db.flush()
            await self.db.commit()
            _invalidate_preview_cache(normalized)

            from app.services.subdomain_service import SubdomainService

            subdomain_service = SubdomainService(self.db, organization_id=self.organization_id)
            persisted_subdomains = await subdomain_service.list_by_domain(domain.id)

            return {
                "domain": _domain_to_response(domain, health_check),
                "subdomains": persisted_subdomains,
                "notifications": {
                    "preferences": prefs,
                    "include_subdomains": data.notifications.include_subdomains,
                },
            }
        except IntegrityError as exc:
            await self.db.rollback()
            raise DomainSetupError(
                "No se pudo completar la carga del dominio porque ya existe un registro conflictivo."
            ) from exc

    async def scan_and_update(self, domain_id: int) -> dict | None:
        q = self._org_filter(select(Domain).where(Domain.id == domain_id))
        result = await self.db.execute(q)
        domain = result.scalar_one_or_none()
        if not domain:
            return None

        scan = await full_domain_scan(
            domain.name, monitor_method=domain.monitor_method or "http", monitor_port=domain.monitor_port
        )

        if scan.get("whois"):
            whois = scan["whois"]
            if whois.registrar:
                domain.registrar = whois.registrar
            if whois.expiration_date:
                domain.expires_at = _normalize_datetime(whois.expiration_date)

        for snap_type, data in [
            ("whois", scan.get("whois")),
            ("rdap", scan.get("rdap")),
            ("dns", scan.get("dns")),
            ("providers", scan.get("providers")),
            ("ssl", scan.get("ssl")),
            ("email_security", scan.get("email_security")),
            ("tech_stack", scan.get("tech_stack")),
            ("blacklists", scan.get("blacklists")),
            ("host_intel", scan.get("host_intel")),
            ("subdomains", scan.get("subdomains")),
        ]:
            if data is not None:
                self.db.add(DomainSnapshot(
                    domain_id=domain.id,
                    snapshot_type=snap_type,
                    data=_snapshot_payload(data),
                ))

        health = scan.get("health", {}) or {}
        ssl_data = scan.get("ssl")
        hc = HealthCheck(
            domain_id=domain.id,
            status_code=health.get("status_code"),
            response_time_ms=health.get("response_time_ms"),
            is_up=health.get("is_up", False),
            ssl_valid=ssl_data.is_valid if ssl_data else None,
            ssl_expires_at=_normalize_datetime(ssl_data.valid_until) if ssl_data else None,
        )
        self.db.add(hc)

        if domain.expires_at and (domain.expires_at - datetime.utcnow()).days <= 30:
            days_left = (domain.expires_at - datetime.utcnow()).days
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="renewal",
                severity="warning" if days_left > 7 else "critical",
                title=f"Domain expiring soon: {domain.name}",
                message=f"{domain.name} expires in {days_left} days",
                domain_name=domain.name,
            )

        if ssl_data and ssl_data.days_remaining is not None and ssl_data.days_remaining <= 30:
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="ssl_expiry",
                severity="warning" if ssl_data.days_remaining > 7 else "critical",
                title=f"SSL expiring soon: {domain.name}",
                message=f"SSL certificate expires in {ssl_data.days_remaining} days",
                domain_name=domain.name,
            )

        if not health.get("is_up"):
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="downtime",
                severity="critical",
                title=f"Domain down: {domain.name}",
                message=f"{domain.name} is not responding",
                domain_name=domain.name,
            )

        blacklists = scan.get("blacklists")
        if blacklists and getattr(blacklists, "is_listed", False):
            listed = [l.get("blacklist") for l in (blacklists.listings or []) if l.get("listed")]
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="blacklist",
                severity="critical",
                title=f"IP en blacklist: {domain.name}",
                message=f"{domain.name} ({getattr(blacklists, 'ip', '?')}) aparece en: {', '.join(listed[:5])}",
                domain_name=domain.name,
            )

        abuse = getattr(blacklists, "abuseipdb", None) if blacklists else None
        if abuse and (abuse.get("score") or 0) >= 50:
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="abuseipdb",
                severity="critical" if abuse.get("score", 0) >= 75 else "warning",
                title=f"AbuseIPDB score alto: {domain.name}",
                message=f"Score {abuse.get('score')} — {abuse.get('totalReports', 0)} reportes",
                domain_name=domain.name,
            )

        host_intel = scan.get("host_intel") or {}
        if host_intel.get("is_threat"):
            flags = host_intel.get("threat_flags") or {}
            active = [k for k, v in flags.items() if v]
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="threat",
                severity="critical",
                title=f"Amenaza detectada: {domain.name}",
                message=f"IP {host_intel.get('ip')} marcada como amenaza ({', '.join(active) or 'threat'})",
                domain_name=domain.name,
            )

        email = scan.get("email_security")
        if email and getattr(email, "score", 100) < 50:
            await create_alert(
                self.db,
                organization_id=domain.organization_id,
                domain_id=domain.id,
                alert_type="email_security",
                severity="warning",
                title=f"Email security débil: {domain.name}",
                message=f"Score {email.score}/100 — revisar SPF/DKIM/DMARC",
                domain_name=domain.name,
            )

        domain.updated_at = datetime.utcnow()
        await self.db.commit()

        return self._serialize_scan(scan)

    async def get_snapshots(self, domain_id: int) -> list[dict]:
        domain = await self.get_domain(domain_id)
        if not domain:
            return []
        result = await self.db.execute(
            select(DomainSnapshot)
            .where(DomainSnapshot.domain_id == domain_id)
            .order_by(DomainSnapshot.created_at.desc())
            .limit(50)
        )
        return [
            {"id": s.id, "type": s.snapshot_type, "data": s.data, "created_at": s.created_at}
            for s in result.scalars().all()
        ]

    async def get_dashboard_stats(self) -> DashboardStats:
        result = await self.db.execute(self._org_filter(select(Domain)))
        domains = result.scalars().all()
        domain_ids = {d.id for d in domains}
        total = len(domains)
        expiring_soon = sum(
            1 for d in domains
            if (expires_at := _normalize_datetime(d.expires_at)) and (expires_at - datetime.utcnow()).days <= 30
        )
        total_value = sum(d.estimated_value or 0 for d in domains)
        total_renewal = sum(d.renewal_cost or 0 for d in domains)

        health_result = await self.db.execute(select(HealthCheck))
        health_checks = health_result.scalars().all()
        latest_by_domain: dict[int, HealthCheck] = {}
        for hc in health_checks:
            if hc.domain_id not in domain_ids:
                continue
            if hc.domain_id not in latest_by_domain or hc.checked_at > latest_by_domain[hc.domain_id].checked_at:
                latest_by_domain[hc.domain_id] = hc

        domains_up = sum(1 for hc in latest_by_domain.values() if hc.is_up)
        domains_down = len(latest_by_domain) - domains_up
        ssl_expiring = sum(
            1 for hc in latest_by_domain.values()
            if (ssl_expires_at := _normalize_datetime(hc.ssl_expires_at)) and (ssl_expires_at - datetime.utcnow()).days <= 30
        )

        alert_filters = [
            Alert.created_at >= datetime.utcnow() - timedelta(days=7),
            Alert.is_read == False,
        ]
        if self.organization_id is not None:
            alert_filters.append(Alert.organization_id == self.organization_id)
        alert_result = await self.db.execute(
            select(func.count(Alert.id)).where(*alert_filters)
        )
        recent_alerts = alert_result.scalar() or 0

        by_registrar: dict[str, int] = {}
        by_status: dict[str, int] = {}
        for d in domains:
            reg = d.registrar or "Unknown"
            by_registrar[reg] = by_registrar.get(reg, 0) + 1
            by_status[d.status] = by_status.get(d.status, 0) + 1

        return DashboardStats(
            total_domains=total,
            expiring_soon=expiring_soon,
            total_value=total_value,
            total_renewal_cost=total_renewal,
            domains_up=domains_up,
            domains_down=domains_down,
            ssl_expiring_soon=ssl_expiring,
            recent_alerts=recent_alerts,
            by_registrar=by_registrar,
            by_status=by_status,
            portfolio_trend=[
                {"month": "Jan", "value": total_value * 0.85},
                {"month": "Feb", "value": total_value * 0.88},
                {"month": "Mar", "value": total_value * 0.92},
                {"month": "Apr", "value": total_value * 0.95},
                {"month": "May", "value": total_value * 0.97},
                {"month": "Jun", "value": total_value},
            ],
        )

    async def compare_domains(self, domain_names: list[str]) -> dict:
        comparison: dict = {}
        for name in domain_names:
            scan = await full_domain_scan(name)
            comparison[name] = {
                "ssl_valid": scan.get("ssl").is_valid if scan.get("ssl") else False,
                "ssl_days": scan.get("ssl").days_remaining if scan.get("ssl") else None,
                "is_up": scan.get("health", {}).get("is_up", False),
                "response_time": scan.get("health", {}).get("response_time_ms"),
                "email_score": scan.get("email_security").score if scan.get("email_security") else 0,
                "subdomains": scan.get("subdomains").total_found if scan.get("subdomains") else 0,
                "blacklisted": scan.get("blacklists").is_listed if scan.get("blacklists") else False,
                "technologies": len(scan.get("tech_stack").technologies) if scan.get("tech_stack") else 0,
            }
        return {"domains": domain_names, "comparison": comparison}


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _tags_to_str(tags: list[str] | None) -> str | None:
    return ",".join(tags) if tags else None


def _tags_from_str(tags: str | None) -> list[str]:
    return [t.strip() for t in tags.split(",") if t.strip()] if tags else []


def _serialize_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [
            item.model_dump(mode="json") if hasattr(item, "model_dump") else item
            for item in value
        ]
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _snapshot_payload(data) -> dict | list:
    serialized = _serialize_value(data)
    if isinstance(serialized, (dict, list)):
        return serialized
    return {"data": serialized}


def _domain_to_response(domain: Domain, health: HealthCheck | None = None) -> dict:
    expires_at = _normalize_datetime(domain.expires_at)
    days_until_expiry = None
    if expires_at:
        days_until_expiry = (expires_at - datetime.utcnow()).days

    latest_health = None
    if health:
        latest_health = {
            "is_up": health.is_up,
            "status_code": health.status_code,
            "response_time_ms": health.response_time_ms,
            "ssl_valid": health.ssl_valid,
            "checked_at": health.checked_at.isoformat(),
        }

    last_scanned_at = health.checked_at.isoformat() if health and health.checked_at else None

    from app.scheduler import get_next_domain_scan_at

    return {
        "id": domain.id,
        "name": domain.name,
        "registrar": domain.registrar,
        "status": domain.status,
        "purchase_price": domain.purchase_price,
        "renewal_cost": domain.renewal_cost,
        "estimated_value": domain.estimated_value,
        "expires_at": expires_at,
        "auto_renew": domain.auto_renew,
        "monitor_method": domain.monitor_method or "http",
        "monitor_port": domain.monitor_port,
        "notes": domain.notes,
        "tags": _tags_from_str(domain.tags),
        "created_at": domain.created_at,
        "updated_at": domain.updated_at,
        "days_until_expiry": days_until_expiry,
        "latest_health": latest_health,
        "last_scanned_at": last_scanned_at,
        "next_scan_at": get_next_domain_scan_at(),
    }
