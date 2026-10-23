"""Create the initial admin user and organization (idempotent).

Reads FACUTOOLS_ADMIN_EMAIL, FACUTOOLS_ADMIN_NAME, FACUTOOLS_ADMIN_PASSWORD and
FACUTOOLS_ORG_NAME from the environment so the password never appears in argv.
Usage: python -m app.create_superadmin
"""

from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import select

from app.auth.rbac import create_organization_with_admin
from app.auth.security import hash_password
from app.database import async_session
from app.models import User


async def main() -> int:
    email = os.environ.get("FACUTOOLS_ADMIN_EMAIL", "").strip().lower()
    name = os.environ.get("FACUTOOLS_ADMIN_NAME", "").strip() or "Admin"
    password = os.environ.get("FACUTOOLS_ADMIN_PASSWORD", "")
    org_name = os.environ.get("FACUTOOLS_ORG_NAME", "").strip() or "FacuTools"

    if not email or "@" not in email:
        print("ERROR: FACUTOOLS_ADMIN_EMAIL invalido", file=sys.stderr)
        return 1
    if len(password) < 8:
        print("ERROR: la contrasena debe tener al menos 8 caracteres", file=sys.stderr)
        return 1

    async with async_session() as db:
        existing = await db.scalar(select(User).where(User.email == email))
        if existing:
            print(f"El usuario {email} ya existe; no se modifica.")
            return 0

        user = User(
            email=email,
            name=name,
            hashed_password=hash_password(password),
            role="admin",
            password_set=True,
            is_active=True,
        )
        db.add(user)
        await db.flush()
        await create_organization_with_admin(db, name=org_name, slug="default", admin=user)
        await db.commit()

    print(f"Superadmin creado: {email}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
