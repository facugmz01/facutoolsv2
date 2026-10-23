from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import AuthContext, require_permissions
from app.auth.permissions import ALL_PERMISSION_CODES
from app.database import get_db
from app.models import Permission, Role, RolePermission
from app.schemas_auth import PermissionOut, RoleCreate, RoleOut, RoleUpdate

router = APIRouter()


def _role_out(role: Role) -> RoleOut:
    codes = sorted({rp.permission.code for rp in role.role_permissions if rp.permission})
    return RoleOut(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permission_codes=codes,
        created_at=role.created_at,
    )


async def _load_role(db: AsyncSession, role_id: int, org_id: int) -> Optional[Role]:
    result = await db.execute(
        select(Role)
        .options(selectinload(Role.role_permissions).selectinload(RolePermission.permission))
        .where(Role.id == role_id, Role.organization_id == org_id)
    )
    return result.scalar_one_or_none()


@router.get("/permissions", response_model=list[PermissionOut])
async def list_permissions(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("roles:read")),
):
    result = await db.execute(select(Permission).order_by(Permission.code))
    return [PermissionOut(code=p.code, description=p.description) for p in result.scalars().all()]


@router.get("", response_model=list[RoleOut])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("roles:read")),
):
    result = await db.execute(
        select(Role)
        .options(selectinload(Role.role_permissions).selectinload(RolePermission.permission))
        .where(Role.organization_id == ctx.organization_id)
        .order_by(Role.is_system.desc(), Role.name)
    )
    return [_role_out(r) for r in result.scalars().all()]


@router.post("", response_model=RoleOut, status_code=201)
async def create_role(
    data: RoleCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("roles:write")),
):
    existing = await db.execute(
        select(Role).where(
            Role.organization_id == ctx.organization_id,
            Role.name == data.name.strip(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Role name already exists")

    invalid = [c for c in data.permission_codes if c not in ALL_PERMISSION_CODES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid)}")

    role = Role(
        organization_id=ctx.organization_id,
        name=data.name.strip(),
        description=data.description,
        is_system=False,
    )
    db.add(role)
    await db.flush()

    if data.permission_codes:
        perms = await db.execute(
            select(Permission).where(Permission.code.in_(data.permission_codes))
        )
        for perm in perms.scalars().all():
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    await db.commit()
    role = await _load_role(db, role.id, ctx.organization_id)
    return _role_out(role)


@router.put("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int,
    data: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("roles:write")),
):
    role = await _load_role(db, role_id, ctx.organization_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if data.name is not None:
        if role.is_system and data.name.strip() != role.name:
            raise HTTPException(status_code=400, detail="Cannot rename system roles")
        role.name = data.name.strip()
    if data.description is not None:
        role.description = data.description

    if data.permission_codes is not None:
        invalid = [c for c in data.permission_codes if c not in ALL_PERMISSION_CODES]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid)}")
        # Clear and re-add
        for rp in list(role.role_permissions):
            await db.delete(rp)
        await db.flush()
        if data.permission_codes:
            perms = await db.execute(
                select(Permission).where(Permission.code.in_(data.permission_codes))
            )
            for perm in perms.scalars().all():
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    await db.commit()
    role = await _load_role(db, role_id, ctx.organization_id)
    return _role_out(role)


@router.delete("/{role_id}", status_code=204)
async def delete_role(
    role_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("roles:write")),
):
    role = await _load_role(db, role_id, ctx.organization_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system roles")
    if role.memberships:
        raise HTTPException(status_code=400, detail="Role is assigned to members")
    await db.delete(role)
    await db.commit()
