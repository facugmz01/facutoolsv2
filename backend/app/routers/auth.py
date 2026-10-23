from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.auth.rbac import (
    create_organization_with_admin,
    list_user_memberships,
    membership_permission_codes,
)
from app.auth.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    refresh_token_expiry,
    verify_password,
)
from app.database import get_db
from app.models import Invitation, Membership, RefreshToken, User
from app.schemas_auth import (
    AcceptInviteRequest,
    AuthStatusResponse,
    LoginRequest,
    MeResponse,
    OrganizationOut,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)

router = APIRouter()


async def _issue_tokens(db: AsyncSession, user: User) -> TokenPair:
    access = create_access_token(user.id)
    raw_refresh = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=refresh_token_expiry(),
        )
    )
    await db.commit()
    return TokenPair(access_token=access, refresh_token=raw_refresh)


def _org_out(membership: Membership) -> OrganizationOut:
    return OrganizationOut(
        id=membership.organization.id,
        name=membership.organization.name,
        slug=membership.organization.slug,
        role_name=membership.role.name if membership.role else None,
        permissions=membership_permission_codes(membership),
    )


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(db: AsyncSession = Depends(get_db)):
    count = await db.scalar(select(func.count()).select_from(User))
    return AuthStatusResponse(bootstrap_required=(count or 0) == 0)


@router.post("/register", response_model=TokenPair)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    count = await db.scalar(select(func.count()).select_from(User))
    if (count or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed. Ask an admin for an invitation.",
        )

    existing = await db.execute(select(User).where(User.email == data.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email.lower().strip(),
        name=data.name.strip(),
        hashed_password=hash_password(data.password),
        role="admin",
        password_set=True,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await create_organization_with_admin(
        db,
        name=(data.organization_name or "FacuTools").strip() or "FacuTools",
        slug="default",
        admin=user,
    )
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(db, user)


@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.password_set or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    memberships = await list_user_memberships(db, user.id)
    if not memberships:
        raise HTTPException(status_code=403, detail="No organization membership")

    return await _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(data.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    row = result.scalar_one_or_none()
    if not row or row.revoked_at or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive")

    row.revoked_at = datetime.utcnow()
    await db.commit()
    return await _issue_tokens(db, user)


@router.post("/logout")
async def logout(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(data.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    row = result.scalar_one_or_none()
    if row and not row.revoked_at:
        row.revoked_at = datetime.utcnow()
        await db.commit()
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    memberships = await list_user_memberships(db, user.id)
    org = _org_out(memberships[0]) if memberships else None
    perms: List[str] = org.permissions if org else []

    count = await db.scalar(select(func.count()).select_from(User))
    return MeResponse(
        user=UserOut.model_validate(user),
        organization=org,
        permissions=perms,
        bootstrap_required=(count or 0) == 0,
    )


@router.post("/accept-invite", response_model=TokenPair)
async def accept_invite(data: AcceptInviteRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(data.token)
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.organization), selectinload(Invitation.role))
        .where(Invitation.token_hash == token_hash)
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.accepted_at or invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")

    result = await db.execute(select(User).where(User.email == invite.email.lower()))
    user = result.scalar_one_or_none()
    if user:
        user.hashed_password = hash_password(data.password)
        user.password_set = True
        user.name = data.name.strip() or user.name
        user.is_active = True
    else:
        user = User(
            email=invite.email.lower(),
            name=data.name.strip(),
            hashed_password=hash_password(data.password),
            role="member",
            password_set=True,
            is_active=True,
        )
        db.add(user)
        await db.flush()

    existing_m = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == invite.organization_id,
        )
    )
    membership = existing_m.scalar_one_or_none()
    if membership:
        membership.role_id = invite.role_id
        membership.status = "active"
    else:
        db.add(
            Membership(
                user_id=user.id,
                organization_id=invite.organization_id,
                role_id=invite.role_id,
                status="active",
            )
        )

    invite.accepted_at = datetime.utcnow()
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(db, user)
