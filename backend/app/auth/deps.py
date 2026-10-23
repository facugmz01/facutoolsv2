from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Callable, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import list_user_memberships, membership_permission_codes
from app.auth.security import decode_access_token
from app.database import get_db
from app.models import Membership, User

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    membership: Membership
    organization_id: int
    permissions: list[str]

    def has(self, *codes: str) -> bool:
        return all(code in self.permissions for code in codes)


async def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive or not found")
    return user


async def get_auth_context(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthContext:
    """Single-organization mode: use the user's only (or first) membership."""
    memberships = await list_user_memberships(db, user.id)
    if not memberships:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organization membership")

    membership = memberships[0]
    return AuthContext(
        user=user,
        membership=membership,
        organization_id=membership.organization_id,
        permissions=membership_permission_codes(membership),
    )


def require_permissions(*codes: str) -> Callable:
    async def dependency(ctx: Annotated[AuthContext, Depends(get_auth_context)]) -> AuthContext:
        missing = [c for c in codes if c not in ctx.permissions]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(missing)}",
            )
        return ctx

    return dependency
