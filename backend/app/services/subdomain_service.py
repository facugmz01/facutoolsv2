from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Domain, Subdomain, SubdomainSnapshot
from app.services.domain_scanner import discover_subdomains, full_domain_scan
from app.services.domain_service import _serialize_value, _snapshot_payload
from app.services.ssl_service import SSLService


def _subdomain_to_dict(sub: Subdomain) -> dict:
    latest_ssl = None
    if sub.ssl_certificates:
        latest = max(sub.ssl_certificates, key=lambda c: c.last_checked_at or c.created_at)
        latest_ssl = {
            "status": latest.status,
            "days_remaining": latest.days_remaining,
            "is_valid": latest.is_valid,
            "issuer": latest.issuer,
        }

    from app.scheduler import get_next_domain_scan_at

    last_scanned_at = sub.updated_at.isoformat() if sub.updated_at else None
    return {
        "id": sub.id,
        "domain_id": sub.domain_id,
        "hostname": sub.hostname,
        "is_active": sub.is_active,
        "auto_discovered": sub.auto_discovered,
        "ssl_monitor": sub.ssl_monitor,
        "ssl_auto_renew": sub.ssl_auto_renew,
        "notes": sub.notes,
        "latest_ssl": latest_ssl,
        "created_at": sub.created_at,
        "updated_at": sub.updated_at,
        "last_scanned_at": last_scanned_at,
        "next_scan_at": get_next_domain_scan_at(),
    }


class SubdomainService:
    def __init__(self, db: AsyncSession, organization_id: Optional[int] = None):
        self.db = db
        self.organization_id = organization_id

    async def _assert_domain(self, domain_id: int) -> Domain | None:
        q = select(Domain).where(Domain.id == domain_id)
        if self.organization_id is not None:
            q = q.where(Domain.organization_id == self.organization_id)
        result = await self.db.execute(q)
        return result.scalar_one_or_none()

    async def list_by_domain(self, domain_id: int) -> List[dict]:
        if not await self._assert_domain(domain_id):
            return []

        result = await self.db.execute(
            select(Subdomain)
            .options(selectinload(Subdomain.ssl_certificates))
            .where(Subdomain.domain_id == domain_id)
            .order_by(Subdomain.hostname)
        )
        return [_subdomain_to_dict(s) for s in result.scalars().all()]

    async def get_subdomain(self, subdomain_id: int) -> dict | None:
        result = await self.db.execute(
            select(Subdomain)
            .options(selectinload(Subdomain.ssl_certificates), selectinload(Subdomain.domain))
            .where(Subdomain.id == subdomain_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            return None
        if self.organization_id is not None and (
            not sub.domain or sub.domain.organization_id != self.organization_id
        ):
            return None
        data = _subdomain_to_dict(sub)
        data["domain_name"] = sub.domain.name if sub.domain else None
        return data

    def _serialize_scan(self, scan: dict) -> dict:
        return {key: _serialize_value(value) for key, value in scan.items()}

    async def scan_and_update(self, subdomain_id: int) -> dict | None:
        result = await self.db.execute(
            select(Subdomain).where(Subdomain.id == subdomain_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            return None

        scan = await full_domain_scan(sub.hostname)
        serialized = self._serialize_scan(scan)

        for snap_type, data in [
            ("dns", scan.get("dns")),
            ("providers", scan.get("providers")),
            ("ssl", scan.get("ssl")),
            ("health", scan.get("health")),
            ("email_security", scan.get("email_security")),
            ("tech_stack", scan.get("tech_stack")),
            ("blacklists", scan.get("blacklists")),
            ("host_intel", scan.get("host_intel")),
        ]:
            if data is not None:
                self.db.add(SubdomainSnapshot(
                    subdomain_id=sub.id,
                    snapshot_type=snap_type,
                    data=_snapshot_payload(data),
                ))

        sub.updated_at = datetime.utcnow()
        await self.db.commit()

        ssl_service = SSLService(self.db, organization_id=self.organization_id)
        await ssl_service.check_hostname(sub.hostname, domain_id=sub.domain_id, subdomain_id=sub.id)

        return serialized

    async def get_snapshots(self, subdomain_id: int) -> list[dict]:
        result = await self.db.execute(
            select(SubdomainSnapshot)
            .where(SubdomainSnapshot.subdomain_id == subdomain_id)
            .order_by(SubdomainSnapshot.created_at.desc())
            .limit(50)
        )
        return [
            {"id": s.id, "type": s.snapshot_type, "data": s.data, "created_at": s.created_at}
            for s in result.scalars().all()
        ]

    async def create(
        self,
        domain_id: int,
        hostname: str,
        ssl_monitor: bool = True,
        ssl_auto_renew: bool = False,
        notes: Optional[str] = None,
    ) -> dict:
        if not await self._assert_domain(domain_id):
            raise ValueError("Domain not found")
        hostname = hostname.lower().strip()
        existing = await self.db.execute(select(Subdomain).where(Subdomain.hostname == hostname))
        if existing.scalar_one_or_none():
            raise ValueError(f"Subdomain {hostname} already exists")

        sub = Subdomain(
            domain_id=domain_id,
            hostname=hostname,
            auto_discovered=False,
            ssl_monitor=ssl_monitor,
            ssl_auto_renew=ssl_auto_renew,
            notes=notes,
        )
        self.db.add(sub)
        await self.db.commit()
        await self.db.refresh(sub)

        if ssl_monitor:
            ssl_service = SSLService(self.db)
            await ssl_service.check_hostname(hostname, domain_id=domain_id, subdomain_id=sub.id)

        result = await self.db.execute(
            select(Subdomain)
            .options(selectinload(Subdomain.ssl_certificates))
            .where(Subdomain.id == sub.id)
        )
        sub = result.scalar_one()
        return _subdomain_to_dict(sub)

    async def delete(self, subdomain_id: int) -> bool:
        result = await self.db.execute(select(Subdomain).where(Subdomain.id == subdomain_id))
        sub = result.scalar_one_or_none()
        if not sub:
            return False
        await self.db.delete(sub)
        await self.db.commit()
        return True

    async def update(self, subdomain_id: int, **kwargs) -> Optional[dict]:
        result = await self.db.execute(
            select(Subdomain)
            .options(selectinload(Subdomain.ssl_certificates))
            .where(Subdomain.id == subdomain_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            return None
        for key, value in kwargs.items():
            if value is not None and hasattr(sub, key):
                setattr(sub, key, value)
        sub.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(sub)
        return _subdomain_to_dict(sub)

    async def discover_and_sync(self, domain_id: int) -> List[dict]:
        result = await self.db.execute(select(Domain).where(Domain.id == domain_id))
        domain = result.scalar_one_or_none()
        if not domain:
            return []

        discovery = await discover_subdomains(domain.name, include_certificates=True)
        synced = []

        for item in discovery.subdomains:
            hostname = item["subdomain"]
            existing = await self.db.execute(
                select(Subdomain).where(Subdomain.hostname == hostname)
            )
            if existing.scalar_one_or_none():
                continue

            sub = Subdomain(
                domain_id=domain_id,
                hostname=hostname,
                auto_discovered=True,
                ssl_monitor=True,
            )
            self.db.add(sub)
            synced.append(hostname)

        await self.db.commit()

        return await self.list_by_domain(domain_id)

    async def bulk_create(self, domain_id: int, hostnames: List[str]) -> List[dict]:
        created = []
        for hostname in hostnames:
            try:
                sub = await self.create(domain_id, hostname.strip())
                created.append(sub)
            except ValueError:
                continue
        return created
