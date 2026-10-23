from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import PERMISSIONS, SYSTEM_ROLE_DESCRIPTIONS, SYSTEM_ROLES
from app.models import Membership, Organization, Permission, Role, RolePermission, User


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "org"


async def ensure_permissions(db: AsyncSession) -> dict[str, Permission]:
    result = await db.execute(select(Permission))
    existing = {p.code: p for p in result.scalars().all()}
    for item in PERMISSIONS:
        if item["code"] not in existing:
            perm = Permission(code=item["code"], description=item["description"])
            db.add(perm)
            existing[item["code"]] = perm
    await db.flush()

    system_roles = await db.execute(select(Role).where(Role.is_system.is_(True)))
    for role in system_roles.scalars().all():
        role_codes = SYSTEM_ROLES.get(role.name)
        if role_codes is None:
            continue
        assigned = await db.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
        )
        assigned_ids = set(assigned.scalars().all())
        for code in role_codes:
            permission = existing.get(code)
            if permission and permission.id not in assigned_ids:
                db.add(RolePermission(role_id=role.id, permission_id=permission.id))

    return existing


async def create_system_roles(db: AsyncSession, organization_id: int) -> dict[str, Role]:
    perms = await ensure_permissions(db)
    roles: dict[str, Role] = {}
    for name, codes in SYSTEM_ROLES.items():
        role = Role(
            organization_id=organization_id,
            name=name,
            description=SYSTEM_ROLE_DESCRIPTIONS.get(name, ""),
            is_system=True,
        )
        db.add(role)
        await db.flush()
        for code in codes:
            perm = perms.get(code)
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        roles[name] = role
    await db.flush()
    return roles


async def get_role_permissions(db: AsyncSession, role_id: int) -> list[str]:
    result = await db.execute(
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id == role_id)
    )
    return list(result.scalars().all())


async def load_membership(
    db: AsyncSession,
    user_id: int,
    organization_id: int,
) -> Optional[Membership]:
    result = await db.execute(
        select(Membership)
        .options(
            selectinload(Membership.role).selectinload(Role.role_permissions).selectinload(RolePermission.permission),
            selectinload(Membership.organization),
            selectinload(Membership.user),
        )
        .where(
            Membership.user_id == user_id,
            Membership.organization_id == organization_id,
            Membership.status == "active",
        )
    )
    return result.scalar_one_or_none()


async def list_user_memberships(db: AsyncSession, user_id: int) -> list[Membership]:
    result = await db.execute(
        select(Membership)
        .options(
            selectinload(Membership.organization),
            selectinload(Membership.role).selectinload(Role.role_permissions).selectinload(RolePermission.permission),
        )
        .where(Membership.user_id == user_id, Membership.status == "active")
        .order_by(Membership.id)
    )
    return list(result.scalars().all())


def membership_permission_codes(membership: Membership) -> list[str]:
    role = membership.role
    if not role:
        return []
    return sorted({rp.permission.code for rp in role.role_permissions if rp.permission})


async def create_organization_with_admin(
    db: AsyncSession,
    *,
    name: str,
    slug: Optional[str],
    admin: User,
) -> tuple[Organization, Membership, dict[str, Role]]:
    # Single-organization mode: never create a second org.
    existing_org = (await db.execute(select(Organization).order_by(Organization.id).limit(1))).scalar_one_or_none()
    if existing_org:
        existing_org.name = name.strip() or existing_org.name
        roles_result = await db.execute(select(Role).where(Role.organization_id == existing_org.id))
        roles_list = list(roles_result.scalars().all())
        if not any(r.name == "Admin" for r in roles_list):
            roles = await create_system_roles(db, existing_org.id)
        else:
            roles = {r.name: r for r in roles_list}
        membership = Membership(
            user_id=admin.id,
            organization_id=existing_org.id,
            role_id=roles["Admin"].id,
            status="active",
        )
        db.add(membership)
        await db.flush()
        return existing_org, membership, roles

    base_slug = slugify(slug or name)
    org = Organization(name=name, slug=base_slug or "default")
    db.add(org)
    await db.flush()

    roles = await create_system_roles(db, org.id)
    membership = Membership(
        user_id=admin.id,
        organization_id=org.id,
        role_id=roles["Admin"].id,
        status="active",
    )
    db.add(membership)
    await db.flush()
    return org, membership, roles
