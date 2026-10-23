from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import AuthContext, require_permissions
from app.auth.rbac import membership_permission_codes
from app.auth.security import generate_invite_token, hash_token
from app.database import get_db
from app.models import Invitation, Membership, Organization, Role, User
from app.schemas_auth import (
    InviteCreate,
    InviteOut,
    MemberOut,
    MemberRoleUpdate,
    OrganizationOut,
    OrganizationUpdate,
)

router = APIRouter()


@router.get("/current", response_model=OrganizationOut)
async def get_current_org(ctx: AuthContext = Depends(require_permissions())):
    m = ctx.membership
    return OrganizationOut(
        id=m.organization.id,
        name=m.organization.name,
        slug=m.organization.slug,
        role_name=m.role.name if m.role else None,
        permissions=membership_permission_codes(m),
    )


@router.patch("/current", response_model=OrganizationOut)
async def update_current_org(
    data: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("org:manage")),
):
    org = await db.get(Organization, ctx.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if data.name:
        org.name = data.name.strip()
    await db.commit()
    await db.refresh(org)
    return OrganizationOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        role_name=ctx.membership.role.name if ctx.membership.role else None,
        permissions=ctx.permissions,
    )


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:read")),
):
    result = await db.execute(
        select(Membership)
        .options(selectinload(Membership.user), selectinload(Membership.role))
        .where(Membership.organization_id == ctx.organization_id)
        .order_by(Membership.id)
    )
    members = result.scalars().all()
    return [
        MemberOut(
            id=m.id,
            user_id=m.user_id,
            email=m.user.email,
            name=m.user.name,
            role_id=m.role_id,
            role_name=m.role.name,
            status=m.status,
            created_at=m.created_at,
        )
        for m in members
    ]


@router.patch("/members/{membership_id}", response_model=MemberOut)
async def update_member_role(
    membership_id: int,
    data: MemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:write")),
):
    result = await db.execute(
        select(Membership)
        .options(selectinload(Membership.user), selectinload(Membership.role))
        .where(
            Membership.id == membership_id,
            Membership.organization_id == ctx.organization_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")

    role = await db.get(Role, data.role_id)
    if not role or role.organization_id != ctx.organization_id:
        raise HTTPException(status_code=400, detail="Invalid role")

    membership.role_id = data.role_id
    await db.commit()
    await db.refresh(membership)
    result = await db.execute(
        select(Membership)
        .options(selectinload(Membership.user), selectinload(Membership.role))
        .where(Membership.id == membership.id)
    )
    membership = result.scalar_one()
    return MemberOut(
        id=membership.id,
        user_id=membership.user_id,
        email=membership.user.email,
        name=membership.user.name,
        role_id=membership.role_id,
        role_name=membership.role.name,
        status=membership.status,
        created_at=membership.created_at,
    )


@router.delete("/members/{membership_id}", status_code=204)
async def remove_member(
    membership_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:write")),
):
    result = await db.execute(
        select(Membership).where(
            Membership.id == membership_id,
            Membership.organization_id == ctx.organization_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")
    if membership.user_id == ctx.user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    await db.delete(membership)
    await db.commit()


@router.get("/invitations", response_model=list[InviteOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:read")),
):
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.role))
        .where(
            Invitation.organization_id == ctx.organization_id,
            Invitation.accepted_at.is_(None),
        )
        .order_by(Invitation.created_at.desc())
    )
    invites = result.scalars().all()
    return [
        InviteOut(
            id=i.id,
            email=i.email,
            role_id=i.role_id,
            role_name=i.role.name,
            expires_at=i.expires_at,
            created_at=i.created_at,
        )
        for i in invites
    ]


@router.post("/invitations", response_model=InviteOut, status_code=201)
async def create_invitation(
    data: InviteCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:write")),
):
    role = await db.get(Role, data.role_id)
    if not role or role.organization_id != ctx.organization_id:
        raise HTTPException(status_code=400, detail="Invalid role")

    email = data.email.lower().strip()
    existing_user = await db.execute(select(User).where(User.email == email))
    user = existing_user.scalar_one_or_none()
    if user:
        existing_m = await db.execute(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.organization_id == ctx.organization_id,
            )
        )
        if existing_m.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="User is already a member")

    raw = generate_invite_token()
    invite = Invitation(
        organization_id=ctx.organization_id,
        email=email,
        role_id=data.role_id,
        token_hash=hash_token(raw),
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return InviteOut(
        id=invite.id,
        email=invite.email,
        role_id=invite.role_id,
        role_name=role.name,
        expires_at=invite.expires_at,
        invite_token=raw,
        created_at=invite.created_at,
    )


@router.delete("/invitations/{invite_id}", status_code=204)
async def revoke_invitation(
    invite_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("users:write")),
):
    result = await db.execute(
        select(Invitation).where(
            Invitation.id == invite_id,
            Invitation.organization_id == ctx.organization_id,
        )
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")
    await db.delete(invite)
    await db.commit()
