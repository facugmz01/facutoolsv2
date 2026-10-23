from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import create_organization_with_admin, ensure_permissions
from app.models import Domain, Organization, SSLCertificate, User, WatchlistItem, Alert, AlertRule


async def seed_permissions(db: AsyncSession) -> None:
    await ensure_permissions(db)
    await db.commit()


async def backfill_default_organization(db: AsyncSession) -> None:
    """Attach orphan portfolio rows to a bootstrap org if needed."""
    result = await db.execute(select(Organization).limit(1))
    org = result.scalar_one_or_none()

    domains_without = await db.execute(
        select(Domain).where(Domain.organization_id.is_(None)).limit(1)
    )
    has_orphan = domains_without.scalar_one_or_none() is not None
    if not has_orphan and org:
        return

    if not org:
        # Create placeholder org only if there is portfolio data or users without memberships
        users = (await db.execute(select(User).limit(1))).scalar_one_or_none()
        if not users and not has_orphan:
            return
        if users:
            org, _, _ = await create_organization_with_admin(
                db, name="Default Organization", slug="default", admin=users
            )
        else:
            org = Organization(name="Default Organization", slug="default")
            db.add(org)
            await db.flush()

    await db.execute(
        text("UPDATE domains SET organization_id = :oid WHERE organization_id IS NULL"),
        {"oid": org.id},
    )
    await db.execute(
        text("UPDATE alerts SET organization_id = :oid WHERE organization_id IS NULL"),
        {"oid": org.id},
    )
    await db.execute(
        text("UPDATE alert_rules SET organization_id = :oid WHERE organization_id IS NULL"),
        {"oid": org.id},
    )
    await db.execute(
        text("UPDATE watchlist SET organization_id = :oid WHERE organization_id IS NULL"),
        {"oid": org.id},
    )
    await db.execute(
        text(
            "UPDATE ssl_certificates SET organization_id = :oid WHERE organization_id IS NULL"
        ),
        {"oid": org.id},
    )

    # Mark existing users with password as password_set
    await db.execute(
        text(
            "UPDATE users SET password_set = TRUE "
            "WHERE hashed_password IS NOT NULL AND hashed_password != ''"
        )
    )
    await db.commit()
