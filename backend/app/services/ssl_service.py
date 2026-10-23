import asyncio
import hashlib
import io
import logging
import os
import socket
import ssl
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.settings_store import SettingsStore
from app.models import Domain, SSLCertificate, SSLCheckHistory, Subdomain
from app.services.domain_scanner import discover_subdomains, fetch_ssl
from app.services.notifications import create_alert

logger = logging.getLogger(__name__)


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _cert_status(days_remaining: Optional[int], is_valid: bool) -> str:
    if not is_valid or days_remaining is None:
        return "missing" if days_remaining is None else "expired"
    if days_remaining <= SettingsStore.get_int("ssl_expiry_critical_days", 7):
        return "critical"
    if days_remaining <= SettingsStore.get_int("ssl_expiry_warning_days", 30):
        return "expiring"
    return "valid"


def _ssl_to_dict(cert: SSLCertificate) -> dict:
    has_files = bool(cert.cert_path and cert.key_path)
    is_revoked = cert.status == "revoked"
    issued = (
        cert.managed
        and not is_revoked
        and cert.acme_status in ("issued", "self_signed")
        and cert.status not in ("pending_generation", "missing", "failed")
        and (has_files or cert.status in ("valid", "expiring", "critical"))
    )
    return {
        "id": cert.id,
        "domain_id": cert.domain_id,
        "subdomain_id": cert.subdomain_id,
        "hostname": cert.hostname,
        "issuer": cert.issuer,
        "subject": cert.subject,
        "valid_from": cert.valid_from,
        "valid_until": cert.valid_until,
        "days_remaining": cert.days_remaining,
        "is_valid": cert.is_valid,
        "status": cert.status,
        "protocol": cert.protocol,
        "cipher": cert.cipher,
        "fingerprint": cert.fingerprint,
        "sans": cert.sans or [],
        "is_wildcard": bool(cert.is_wildcard),
        "cert_type": cert.cert_type or "external",
        "auto_renew": cert.auto_renew,
        "managed": cert.managed,
        "acme_status": cert.acme_status,
        "challenge_type": cert.challenge_type,
        "challenge_dns_name": cert.challenge_dns_name,
        "challenge_dns_value": cert.challenge_dns_value,
        "challenges": cert.challenges or (
            [{"dns_name": cert.challenge_dns_name, "dns_value": cert.challenge_dns_value}]
            if cert.challenge_dns_name and cert.challenge_dns_value else []
        ),
        "cert_path": cert.cert_path,
        "key_path": cert.key_path,
        "issued": bool(issued),
        "downloadable": bool(has_files and not is_revoked),
        "last_checked_at": cert.last_checked_at,
        "last_error": cert.last_error,
        "created_at": cert.created_at,
        "updated_at": cert.updated_at,
    }


class SSLService:
    def __init__(self, db: AsyncSession, organization_id: Optional[int] = None):
        self.db = db
        self.organization_id = organization_id

    def _org_filter(self, query):
        if self.organization_id is not None:
            return query.where(SSLCertificate.organization_id == self.organization_id)
        return query

    def _storage_dir(self, hostname: str, cert_type: str) -> Path:
        from app.services.ssl_generator import safe_fs_name

        base = Path(SettingsStore.get_str("certs_storage_path", "./data/certs"))
        kind = (cert_type or "managed").replace(" ", "_")
        return base / f"{safe_fs_name(hostname)}_{kind}"

    async def list_certificates(self, domain_id: Optional[int] = None) -> List[dict]:
        query = select(SSLCertificate).order_by(
            SSLCertificate.hostname,
            SSLCertificate.cert_type,
            SSLCertificate.is_wildcard.desc(),
            SSLCertificate.id.desc(),
        )
        query = self._org_filter(query)
        if domain_id:
            query = query.where(SSLCertificate.domain_id == domain_id)
        result = await self.db.execute(query)
        return [_ssl_to_dict(c) for c in result.scalars().all()]

    async def get_certificate(self, cert_id: int) -> Optional[dict]:
        query = self._org_filter(select(SSLCertificate).where(SSLCertificate.id == cert_id))
        result = await self.db.execute(query)
        cert = result.scalar_one_or_none()
        return _ssl_to_dict(cert) if cert else None

    async def get_history(self, cert_id: int, limit: int = 50) -> List[dict]:
        result = await self.db.execute(
            select(SSLCheckHistory)
            .where(SSLCheckHistory.certificate_id == cert_id)
            .order_by(SSLCheckHistory.checked_at.desc())
            .limit(limit)
        )
        return [
            {
                "id": h.id,
                "is_valid": h.is_valid,
                "days_remaining": h.days_remaining,
                "status": h.status,
                "checked_at": h.checked_at,
            }
            for h in result.scalars().all()
        ]

    async def check_hostname(
        self,
        hostname: str,
        domain_id: Optional[int] = None,
        subdomain_id: Optional[int] = None,
    ) -> dict:
        try:
            ssl_info = await fetch_ssl(hostname)
            ssl_error = None
        except ValueError as exc:
            ssl_info = None
            ssl_error = str(exc)

        # Live monitoring row is separate from managed issued certs
        result = await self.db.execute(
            select(SSLCertificate).where(
                SSLCertificate.hostname == hostname,
                SSLCertificate.managed == False,
            )
        )
        cert = result.scalar_one_or_none()
        if not cert:
            # Backward compat: reuse an unmanaged-looking row keyed only by hostname
            result = await self.db.execute(
                select(SSLCertificate).where(
                    SSLCertificate.hostname == hostname,
                    or_(
                        SSLCertificate.cert_type == "external",
                        SSLCertificate.cert_type.is_(None),
                        SSLCertificate.cert_type == "",
                    ),
                )
            )
            cert = result.scalar_one_or_none()

        if not cert:
            cert = SSLCertificate(
                organization_id=self.organization_id,
                hostname=hostname,
                domain_id=domain_id,
                subdomain_id=subdomain_id,
                cert_type="external",
                managed=False,
            )
            self.db.add(cert)
        elif self.organization_id and not cert.organization_id:
            cert.organization_id = self.organization_id

        if ssl_info:
            cert.issuer = ssl_info.issuer
            cert.subject = ssl_info.subject
            cert.valid_from = _naive_utc(ssl_info.valid_from)
            cert.valid_until = _naive_utc(ssl_info.valid_until)
            cert.days_remaining = ssl_info.days_remaining
            cert.is_valid = ssl_info.is_valid
            cert.protocol = ssl_info.protocol
            cert.cipher = ssl_info.cipher
            cert.status = _cert_status(ssl_info.days_remaining, ssl_info.is_valid)
            cert.last_error = None
        else:
            cert.is_valid = False
            cert.days_remaining = None
            cert.status = "missing"
            cert.last_error = ssl_error or "Could not retrieve SSL certificate"

        cert.last_checked_at = datetime.utcnow()
        cert.updated_at = datetime.utcnow()

        await self.db.flush()

        self.db.add(SSLCheckHistory(
            certificate_id=cert.id,
            is_valid=cert.is_valid,
            days_remaining=cert.days_remaining,
            status=cert.status,
        ))

        await self._create_ssl_alerts(cert)
        await self.db.commit()
        await self.db.refresh(cert)
        return _ssl_to_dict(cert)

    async def _create_ssl_alerts(self, cert: SSLCertificate):
        if cert.status in ("critical", "expired", "missing"):
            severity = "critical" if cert.status in ("expired", "missing") else "warning"
            await create_alert(
                self.db,
                organization_id=cert.organization_id or self.organization_id,
                domain_id=cert.domain_id,
                alert_type="ssl_expiry",
                severity=severity,
                title=f"SSL {cert.status}: {cert.hostname}",
                message=(
                    f"SSL certificate for {cert.hostname} is {cert.status}"
                    + (f" ({cert.days_remaining} days remaining)" if cert.days_remaining is not None else "")
                ),
                domain_name=cert.hostname,
            )

    async def monitor_all(self) -> dict:
        monitored = 0
        issues = 0

        dq = select(Domain)
        if self.organization_id is not None:
            dq = dq.where(Domain.organization_id == self.organization_id)
        domains = (await self.db.execute(dq)).scalars().all()
        for domain in domains:
            try:
                await self.check_hostname(domain.name, domain_id=domain.id)
                monitored += 1
            except Exception as e:
                logger.error(f"SSL check failed for {domain.name}: {e}")
                issues += 1

        subdomains = (
            await self.db.execute(
                select(Subdomain).where(Subdomain.is_active == True, Subdomain.ssl_monitor == True)
            )
        ).scalars().all()

        for sub in subdomains:
            try:
                await self.check_hostname(sub.hostname, domain_id=sub.domain_id, subdomain_id=sub.id)
                monitored += 1
            except Exception as e:
                logger.error(f"SSL check failed for {sub.hostname}: {e}")
                issues += 1

        return {"monitored": monitored, "issues": issues}

    async def _get_or_create_managed_cert(
        self,
        hostname: str,
        *,
        domain_id: Optional[int] = None,
        subdomain_id: Optional[int] = None,
        cert_type: str,
        is_wildcard: bool,
    ) -> SSLCertificate:
        """Find a managed cert slot by type + wildcard scope, not only hostname."""
        query = select(SSLCertificate).where(
            SSLCertificate.managed == True,
            SSLCertificate.cert_type == cert_type,
            SSLCertificate.is_wildcard == bool(is_wildcard),
        )
        if subdomain_id is not None:
            query = query.where(SSLCertificate.subdomain_id == subdomain_id)
        elif domain_id is not None:
            query = query.where(
                SSLCertificate.domain_id == domain_id,
                SSLCertificate.subdomain_id.is_(None),
            )
        else:
            query = query.where(SSLCertificate.hostname == hostname)

        query = self._org_filter(query).order_by(SSLCertificate.id.desc())
        result = await self.db.execute(query)
        cert = result.scalars().first()

        if not cert:
            cert = SSLCertificate(
                organization_id=self.organization_id,
                hostname=hostname,
                domain_id=domain_id,
                subdomain_id=subdomain_id,
                managed=True,
                cert_type=cert_type,
                is_wildcard=bool(is_wildcard),
            )
            self.db.add(cert)
            await self.db.flush()
        else:
            cert.hostname = hostname
            cert.managed = True
            cert.cert_type = cert_type
            cert.is_wildcard = bool(is_wildcard)
            if domain_id is not None:
                cert.domain_id = domain_id
            if subdomain_id is not None:
                cert.subdomain_id = subdomain_id
            if self.organization_id and not cert.organization_id:
                cert.organization_id = self.organization_id

        return cert

    def _persist_issued(self, cert: SSLCertificate, issued: dict, cert_type: str) -> None:
        names = issued.get("names") or [cert.hostname]
        is_wildcard = bool(issued.get("wildcard")) or any(n.startswith("*.") for n in names)
        cert.hostname = issued.get("hostname") or cert.hostname
        cert.is_wildcard = is_wildcard
        cert.cert_type = "self_signed" if (cert_type == "self_signed" or issued.get("self_signed")) else "letsencrypt"

        cert_dir = self._storage_dir(cert.hostname, cert.cert_type)
        cert_dir.mkdir(parents=True, exist_ok=True)

        cert_path = cert_dir / "fullchain.pem"
        key_path = cert_dir / "privkey.pem"
        cert_path.write_text(issued["certificate"])
        key_path.write_text(issued["private_key"])

        cert.cert_path = str(cert_path)
        cert.key_path = str(key_path)
        cert.sans = list(names)
        cert.managed = True
        cert.acme_status = "issued"
        cert.status = "valid"
        cert.is_valid = True
        cert.valid_from = datetime.utcnow()
        cert.valid_until = issued.get("expires_at")
        if cert.valid_until:
            cert.days_remaining = (cert.valid_until - datetime.utcnow()).days
        cert.subject = cert.hostname
        cert.issuer = "Self-signed" if cert.cert_type == "self_signed" else "Let's Encrypt"
        cert.challenge_dns_name = None
        cert.challenge_dns_value = None
        cert.challenges = None
        cert.last_error = None
        cert.updated_at = datetime.utcnow()

    async def request_certificate(
        self,
        hostname: str,
        domain_id: Optional[int] = None,
        subdomain_id: Optional[int] = None,
        challenge_type: str = "dns-01",
        auto_renew: bool = True,
        wildcard: bool = False,
        issuer_type: str = "letsencrypt",
        validity_days: int = 365,
    ) -> dict:
        from app.services.ssl_generator import (
            SSLGenerator,
            normalize_cert_names,
            primary_hostname,
        )

        issuer_type = (issuer_type or "letsencrypt").lower().strip()
        if issuer_type not in ("letsencrypt", "self_signed"):
            raise ValueError("issuer_type must be 'letsencrypt' or 'self_signed'")

        if wildcard and subdomain_id:
            raise ValueError("Wildcard certificates must be requested on the parent domain")

        names = normalize_cert_names(hostname, wildcard=wildcard)
        stored_hostname = primary_hostname(names)
        is_wildcard = any(n.startswith("*.") for n in names)

        if issuer_type == "self_signed":
            return await self.issue_self_signed(
                hostname=hostname,
                domain_id=domain_id,
                subdomain_id=subdomain_id,
                wildcard=wildcard,
                validity_days=validity_days,
                auto_renew=False,
            )

        cert = await self._get_or_create_managed_cert(
            stored_hostname,
            domain_id=domain_id,
            subdomain_id=subdomain_id,
            cert_type="letsencrypt",
            is_wildcard=is_wildcard,
        )
        cert.managed = True
        cert.auto_renew = auto_renew
        cert.cert_type = "letsencrypt"
        cert.is_wildcard = is_wildcard
        cert.sans = list(names)
        cert.acme_status = "pending"
        cert.challenge_type = challenge_type
        cert.status = "pending_generation"
        cert.cert_path = None
        cert.key_path = None
        cert.updated_at = datetime.utcnow()

        generator = SSLGenerator()
        try:
            challenge = await asyncio.to_thread(
                generator.initiate_order,
                hostname,
                challenge_type,
                wildcard,
                names,
            )
            cert.hostname = challenge.get("hostname") or stored_hostname
            cert.challenge_dns_name = challenge.get("dns_name")
            cert.challenge_dns_value = challenge.get("dns_value")
            cert.challenges = challenge.get("challenges") or [
                {"dns_name": challenge.get("dns_name"), "dns_value": challenge.get("dns_value")}
            ]
            cert.acme_status = "awaiting_validation"
            cert.last_error = None
        except Exception as e:
            from app.services.ssl_generator import format_acme_error

            detail = format_acme_error(e)
            cert.acme_status = "failed"
            cert.status = "missing"
            cert.last_error = detail
            logger.error("ACME initiation failed for %s: %s", hostname, detail)
            await self.db.commit()
            await self.db.refresh(cert)
            raise ValueError(f"Let's Encrypt order failed: {detail}") from e

        await self.db.commit()
        await self.db.refresh(cert)
        return _ssl_to_dict(cert)

    async def issue_self_signed(
        self,
        hostname: str,
        domain_id: Optional[int] = None,
        subdomain_id: Optional[int] = None,
        wildcard: bool = False,
        validity_days: int = 365,
        auto_renew: bool = False,
    ) -> dict:
        from app.services.ssl_generator import (
            SSLGenerator,
            normalize_cert_names,
            primary_hostname,
        )

        if wildcard and subdomain_id:
            raise ValueError("Wildcard certificates must be requested on the parent domain")

        names = normalize_cert_names(hostname, wildcard=wildcard)
        stored_hostname = primary_hostname(names)
        is_wildcard = any(n.startswith("*.") for n in names)
        cert = await self._get_or_create_managed_cert(
            stored_hostname,
            domain_id=domain_id,
            subdomain_id=subdomain_id,
            cert_type="self_signed",
            is_wildcard=is_wildcard,
        )
        cert.auto_renew = auto_renew
        cert.challenge_type = None
        cert.status = "pending_generation"
        cert.updated_at = datetime.utcnow()

        generator = SSLGenerator()
        try:
            issued = await asyncio.to_thread(
                generator.generate_self_signed, names, validity_days
            )
            self._persist_issued(cert, issued, cert_type="self_signed")
        except Exception as e:
            cert.acme_status = "failed"
            cert.status = "missing"
            cert.last_error = str(e)
            logger.error(f"Self-signed generation failed for {hostname}: {e}")

        await self.db.commit()
        await self.db.refresh(cert)
        return _ssl_to_dict(cert)

    async def complete_certificate(self, cert_id: int) -> dict:
        from app.services.ssl_generator import SSLGenerator

        result = await self.db.execute(select(SSLCertificate).where(SSLCertificate.id == cert_id))
        cert = result.scalar_one_or_none()
        if not cert:
            return {"error": "Certificate not found"}

        if cert.status == "revoked":
            return {"error": "Certificate is revoked"}

        if cert.cert_type == "self_signed":
            apex = cert.hostname[2:] if cert.hostname.startswith("*.") else cert.hostname
            return await self.issue_self_signed(
                hostname=apex,
                domain_id=cert.domain_id,
                subdomain_id=cert.subdomain_id,
                wildcard=bool(cert.is_wildcard),
                validity_days=365,
                auto_renew=False,
            )

        generator = SSLGenerator()
        try:
            cert.acme_status = "validating"
            cert.last_error = None
            await self.db.commit()

            issued = await asyncio.to_thread(
                generator.finalize_order,
                cert.hostname,
                cert.challenge_type or "dns-01",
            )
            if issued.get("self_signed"):
                raise ValueError("Unexpected self-signed result while completing Let's Encrypt order")
            self._persist_issued(cert, issued, cert_type="letsencrypt")
        except Exception as e:
            from app.services.ssl_generator import format_acme_error

            detail = format_acme_error(e)
            cert.acme_status = "failed"
            cert.status = "pending_generation"
            cert.last_error = detail
            cert.updated_at = datetime.utcnow()
            await self.db.commit()
            await self.db.refresh(cert)
            logger.error("ACME finalize failed for %s: %s", cert.hostname, detail)
            return {**_ssl_to_dict(cert), "error": detail}

        cert.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(cert)
        return _ssl_to_dict(cert)

    async def revoke_certificate(self, cert_id: int) -> dict:
        result = await self.db.execute(select(SSLCertificate).where(SSLCertificate.id == cert_id))
        cert = result.scalar_one_or_none()
        if not cert:
            raise ValueError("Certificate not found")
        if not cert.managed:
            raise ValueError("Only managed certificates can be revoked")
        if cert.status == "revoked":
            return _ssl_to_dict(cert)

        for path_str in (cert.cert_path, cert.key_path):
            if path_str:
                try:
                    Path(path_str).unlink(missing_ok=True)
                except Exception as e:
                    logger.warning(f"Failed to delete cert file {path_str}: {e}")

        # Remove empty storage dir if present
        if cert.cert_path:
            try:
                Path(cert.cert_path).parent.rmdir()
            except Exception:
                pass

        cert.status = "revoked"
        cert.acme_status = "revoked"
        cert.is_valid = False
        cert.auto_renew = False
        cert.cert_path = None
        cert.key_path = None
        cert.challenge_dns_name = None
        cert.challenge_dns_value = None
        cert.challenges = None
        cert.days_remaining = None
        cert.last_error = None
        cert.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(cert)
        return _ssl_to_dict(cert)

    async def renew_expiring(self) -> dict:
        threshold = SettingsStore.get_int("ssl_expiry_warning_days", 30)
        result = await self.db.execute(
            select(SSLCertificate).where(
                SSLCertificate.managed == True,
                SSLCertificate.auto_renew == True,
                SSLCertificate.is_valid == True,
                SSLCertificate.status != "revoked",
                SSLCertificate.cert_type == "letsencrypt",
                SSLCertificate.days_remaining <= threshold,
            )
        )
        certs = result.scalars().all()
        renewed = 0
        for cert in certs:
            try:
                apex = cert.hostname[2:] if cert.hostname.startswith("*.") else cert.hostname
                await self.request_certificate(
                    apex,
                    domain_id=cert.domain_id,
                    subdomain_id=cert.subdomain_id,
                    challenge_type=cert.challenge_type or "dns-01",
                    auto_renew=True,
                    wildcard=bool(cert.is_wildcard),
                    issuer_type="letsencrypt",
                )
                renewed += 1
            except Exception as e:
                logger.error(f"Auto-renew failed for {cert.hostname}: {e}")
        return {"renewal_requests": renewed}

    async def renew_certificate(self, cert_id: int) -> dict:
        result = await self.db.execute(select(SSLCertificate).where(SSLCertificate.id == cert_id))
        cert = result.scalar_one_or_none()
        if not cert:
            raise ValueError("Certificate not found")
        if cert.status == "revoked":
            raise ValueError("Cannot renew a revoked certificate; generate a new one")

        apex = cert.hostname[2:] if cert.hostname.startswith("*.") else cert.hostname
        if cert.cert_type == "self_signed":
            days = 365
            if cert.valid_from and cert.valid_until:
                days = max(1, (cert.valid_until - cert.valid_from).days)
            return await self.issue_self_signed(
                hostname=apex,
                domain_id=cert.domain_id,
                subdomain_id=cert.subdomain_id,
                wildcard=bool(cert.is_wildcard),
                validity_days=days,
                auto_renew=False,
            )

        return await self.request_certificate(
            apex,
            domain_id=cert.domain_id,
            subdomain_id=cert.subdomain_id,
            challenge_type=cert.challenge_type or "dns-01",
            auto_renew=cert.auto_renew,
            wildcard=bool(cert.is_wildcard),
            issuer_type="letsencrypt",
        )

    async def retry_validation(self, cert_id: int) -> dict:
        """Start a fresh ACME order for a pending/failed Let's Encrypt certificate."""
        result = await self.db.execute(select(SSLCertificate).where(SSLCertificate.id == cert_id))
        cert = result.scalar_one_or_none()
        if not cert:
            raise ValueError("Certificate not found")
        if cert.status == "revoked":
            raise ValueError("Certificate is revoked")
        if not cert.managed:
            raise ValueError("Only managed certificates can retry validation")
        if cert.cert_type == "self_signed":
            raise ValueError("Self-signed certificates do not use ACME validation")

        # Drop stale order files so initiate_order cannot resume an invalid order.
        from app.services.ssl_generator import SSLGenerator

        generator = SSLGenerator()
        try:
            generator._clear_order_state(cert.hostname)
        except Exception:
            pass

        return await self.renew_certificate(cert_id)

    def build_download_archive(self, cert_id: int, cert: SSLCertificate) -> tuple[bytes, str]:
        from app.services.ssl_generator import safe_fs_name

        if cert.status == "revoked":
            raise ValueError("Certificate has been revoked")
        if not cert.cert_path or not cert.key_path:
            raise ValueError("Certificate files not available for download")

        cert_path = Path(cert.cert_path)
        key_path = Path(cert.key_path)
        if not cert_path.exists() or not key_path.exists():
            raise ValueError("Certificate files not found on disk")

        kind = (cert.cert_type or "cert").replace(" ", "_")
        scope = "wildcard" if cert.is_wildcard else "single"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(cert_path, "fullchain.pem")
            zf.write(key_path, "privkey.pem")
            readme = (
                f"hostname: {cert.hostname}\n"
                f"type: {kind}\n"
                f"scope: {scope}\n"
                f"issuer: {cert.issuer or ''}\n"
                f"sans: {', '.join(cert.sans or [])}\n"
            )
            zf.writestr("README.txt", readme)
        filename = f"{safe_fs_name(cert.hostname)}_{kind}_{scope}-ssl.zip"
        return buffer.getvalue(), filename

    async def ssl_dashboard(self) -> dict:
        result = await self.db.execute(self._org_filter(select(SSLCertificate)))
        certs = result.scalars().all()
        return {
            "total": len(certs),
            "valid": sum(1 for c in certs if c.status == "valid"),
            "expiring": sum(1 for c in certs if c.status == "expiring"),
            "critical": sum(1 for c in certs if c.status == "critical"),
            "expired": sum(1 for c in certs if c.status == "expired"),
            "missing": sum(1 for c in certs if c.status == "missing"),
            "managed": sum(1 for c in certs if c.managed),
            "issued": sum(
                1 for c in certs
                if c.managed and c.acme_status == "issued" and c.status not in ("revoked",)
            ),
            "revoked": sum(1 for c in certs if c.status == "revoked"),
            "pending_generation": sum(1 for c in certs if c.status == "pending_generation"),
        }

