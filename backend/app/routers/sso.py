from __future__ import annotations

import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import AuthContext, require_permissions
from app.auth.security import create_access_token, generate_refresh_token, hash_token, refresh_token_expiry
from app.config import ENTRA_ONBOARDING_CLIENT_ID, ENTRA_ONBOARDING_CLIENT_SECRET
from app.database import get_db
from app.models import IdentityProvider, Membership, Organization, RefreshToken, Role, User
from app.redis_store import consume_oidc_state, save_oidc_state
from app.secret_store import decrypt_secret, encrypt_secret
from app.schemas_auth import (
    EntraOnboardingStart,
    EntraOnboardingStartOut,
    IdentityProviderCreate,
    IdentityProviderOut,
    IdentityProviderUpdate,
    PublicSSOProvider,
    TokenPair,
)
from app.services.entra_onboarding import (
    ENTRA_ORGANIZATIONS_URL,
    EntraOnboardingError,
    exchange_onboarding_code,
    provision_entra_application,
    tenant_id_from_id_token,
)
from app.settings_store import SettingsStore

router = APIRouter()

def _provider_out(p: IdentityProvider) -> IdentityProviderOut:
    return IdentityProviderOut(
        id=p.id,
        name=p.name,
        type=p.type,
        issuer_url=p.issuer_url,
        client_id=p.client_id,
        scopes=p.scopes,
        enabled=p.enabled,
        auto_provision=p.auto_provision,
        default_role_id=p.default_role_id,
        created_at=p.created_at,
    )


def _frontend_url() -> str:
    origins = SettingsStore.get("cors_origins") or ["http://localhost:5173"]
    if isinstance(origins, list) and origins:
        return str(origins[0]).rstrip("/")
    return "http://localhost:5173"


def _api_public_base() -> str:
    # Callback must hit the API; use first CORS origin's typical API or relative via frontend proxy.
    # Prefer explicit setting if present later; default localhost:8000 for local.
    return SettingsStore.get_str("api_public_url", "http://localhost:8000")


def _profile_email(profile: dict) -> str:
    return str(profile.get("email") or profile.get("preferred_username") or "").lower().strip()


def _provider_redirect_uri(provider: IdentityProvider) -> str:
    base = _api_public_base().rstrip("/")
    if provider.type == "entra_oidc":
        return f"{base}/api/auth/sso/callback"
    return f"{base}/api/auth/sso/{provider.id}/callback"


def _entra_onboarding_redirect_uri() -> str:
    return f"{_api_public_base().rstrip('/')}/api/auth/sso/entra-onboarding/callback"


def _entra_onboarding_return_url(status: str) -> str:
    return f"{_frontend_url()}/settings?{urlencode({'tab': 'security', 'entra_onboarding': status})}"


def _entra_onboarding_credentials() -> tuple[str, str]:
    if not ENTRA_ONBOARDING_CLIENT_ID or not ENTRA_ONBOARDING_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Entra onboarding is not configured on this server",
        )
    return ENTRA_ONBOARDING_CLIENT_ID, ENTRA_ONBOARDING_CLIENT_SECRET


async def _discover(issuer_url: str) -> dict:
    url = issuer_url.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


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


@router.get("/providers", response_model=list[IdentityProviderOut])
async def list_providers(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("sso:manage")),
):
    result = await db.execute(
        select(IdentityProvider)
        .where(IdentityProvider.organization_id == ctx.organization_id)
        .order_by(IdentityProvider.name)
    )
    return [_provider_out(p) for p in result.scalars().all()]


@router.get("/public-providers", response_model=list[PublicSSOProvider])
async def public_providers(db: AsyncSession = Depends(get_db)):
    """List enabled IdPs for the login page (no secrets)."""
    result = await db.execute(
        select(IdentityProvider)
        .options(selectinload(IdentityProvider.organization))
        .where(IdentityProvider.enabled.is_(True))
        .order_by(IdentityProvider.name)
    )
    providers = result.scalars().all()
    return [
        PublicSSOProvider(
            id=p.id,
            name=p.name,
        )
        for p in providers
    ]


@router.post("/providers", response_model=IdentityProviderOut, status_code=201)
async def create_provider(
    data: IdentityProviderCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("sso:manage")),
):
    if data.default_role_id:
        role = await db.get(Role, data.default_role_id)
        if not role or role.organization_id != ctx.organization_id:
            raise HTTPException(status_code=400, detail="Invalid default role")

    provider = IdentityProvider(
        organization_id=ctx.organization_id,
        type="oidc",
        name=data.name.strip(),
        client_id=data.client_id.strip(),
        client_secret_enc=encrypt_secret(data.client_secret),
        issuer_url=data.issuer_url.strip().rstrip("/"),
        scopes=data.scopes,
        enabled=data.enabled,
        auto_provision=data.auto_provision,
        default_role_id=data.default_role_id,
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return _provider_out(provider)


@router.put("/providers/{provider_id}", response_model=IdentityProviderOut)
async def update_provider(
    provider_id: int,
    data: IdentityProviderUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("sso:manage")),
):
    result = await db.execute(
        select(IdentityProvider).where(
            IdentityProvider.id == provider_id,
            IdentityProvider.organization_id == ctx.organization_id,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    if data.name is not None:
        provider.name = data.name.strip()
    if data.issuer_url is not None:
        provider.issuer_url = data.issuer_url.strip().rstrip("/")
    if data.client_id is not None:
        provider.client_id = data.client_id.strip()
    if data.client_secret is not None:
        provider.client_secret_enc = encrypt_secret(data.client_secret)
    if data.scopes is not None:
        provider.scopes = data.scopes
    if data.enabled is not None:
        provider.enabled = data.enabled
    if data.auto_provision is not None:
        provider.auto_provision = data.auto_provision
    if data.default_role_id is not None:
        if data.default_role_id:
            role = await db.get(Role, data.default_role_id)
            if not role or role.organization_id != ctx.organization_id:
                raise HTTPException(status_code=400, detail="Invalid default role")
        provider.default_role_id = data.default_role_id

    await db.commit()
    await db.refresh(provider)
    return _provider_out(provider)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("sso:manage")),
):
    result = await db.execute(
        select(IdentityProvider).where(
            IdentityProvider.id == provider_id,
            IdentityProvider.organization_id == ctx.organization_id,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    await db.delete(provider)
    await db.commit()


@router.post("/entra-onboarding/start", response_model=EntraOnboardingStartOut)
async def start_entra_onboarding(
    data: EntraOnboardingStart,
    ctx: AuthContext = Depends(require_permissions("sso:manage")),
):
    client_id, _ = _entra_onboarding_credentials()
    state = secrets.token_urlsafe(24)
    await save_oidc_state(
        state,
        {
            "flow": "entra_onboarding",
            "organization_id": ctx.organization_id,
            "name": data.name.strip(),
            "auto_provision": data.auto_provision,
        },
    )
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": _entra_onboarding_redirect_uri(),
        "response_mode": "query",
        "scope": "openid profile https://graph.microsoft.com/Application.ReadWrite.All",
        "prompt": "consent",
        "state": state,
    }
    return EntraOnboardingStartOut(
        authorization_url=f"{ENTRA_ORGANIZATIONS_URL}/authorize?{urlencode(params)}"
    )


@router.get("/entra-onboarding/callback")
async def entra_onboarding_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if error or not code or not state:
        return RedirectResponse(_entra_onboarding_return_url("cancelled"))

    stored = await consume_oidc_state(state)
    if not stored or stored.get("flow") != "entra_onboarding":
        return RedirectResponse(_entra_onboarding_return_url("expired"))

    try:
        client_id, client_secret = _entra_onboarding_credentials()
        graph_token, id_token = await exchange_onboarding_code(
            code,
            client_id,
            client_secret,
            _entra_onboarding_redirect_uri(),
        )
        application = await provision_entra_application(
            graph_token,
            tenant_id_from_id_token(id_token),
            stored["name"],
            f"{_api_public_base().rstrip('/')}/api/auth/sso/callback",
        )
        provider = IdentityProvider(
            organization_id=stored["organization_id"],
            type="entra_oidc",
            name=stored["name"],
            client_id=application.client_id,
            client_secret_enc=encrypt_secret(application.client_secret),
            issuer_url=f"https://login.microsoftonline.com/{application.tenant_id}/v2.0",
            scopes="openid profile email",
            enabled=True,
            auto_provision=bool(stored.get("auto_provision")),
        )
        db.add(provider)
        await db.commit()
    except (EntraOnboardingError, KeyError, ValueError):
        await db.rollback()
        return RedirectResponse(_entra_onboarding_return_url("failed"))

    return RedirectResponse(_entra_onboarding_return_url("success"))


@router.get("/{provider_id}/authorize")
async def sso_authorize(provider_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(IdentityProvider).where(
            IdentityProvider.id == provider_id,
            IdentityProvider.enabled.is_(True),
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="SSO provider not found")

    try:
        discovery = await _discover(provider.issuer_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OIDC discovery failed: {exc}") from exc

    authorize_url = discovery.get("authorization_endpoint")
    if not authorize_url:
        raise HTTPException(status_code=502, detail="OIDC provider missing authorization_endpoint")

    state = f"{provider.id}.{secrets.token_urlsafe(24)}"
    await save_oidc_state(state, {
        "provider_id": provider.id,
    })

    redirect_uri = _provider_redirect_uri(provider)
    params = {
        "client_id": provider.client_id,
        "response_type": "code",
        "scope": provider.scopes,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return RedirectResponse(f"{authorize_url}?{urlencode(params)}")


@router.get("/{provider_id}/callback")
async def sso_callback(
    provider_id: int,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await _complete_sso_callback(provider_id, code, state, error, db)


@router.get("/callback")
async def entra_sso_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        provider_id = int((state or "").split(".", 1)[0])
    except ValueError:
        return RedirectResponse(f"{_frontend_url()}/login?error=invalid_state")
    return await _complete_sso_callback(provider_id, code, state, error, db)


async def _complete_sso_callback(
    provider_id: int,
    code: Optional[str],
    state: Optional[str],
    error: Optional[str],
    db: AsyncSession,
):
    frontend = _frontend_url()
    if error:
        return RedirectResponse(f"{frontend}/login?error={error}")
    if not code or not state:
        return RedirectResponse(f"{frontend}/login?error=invalid_state")

    stored = await consume_oidc_state(state)
    if not stored or stored.get("provider_id") != provider_id:
        return RedirectResponse(f"{frontend}/login?error=expired_state")

    result = await db.execute(
        select(IdentityProvider)
        .options(selectinload(IdentityProvider.organization))
        .where(IdentityProvider.id == provider_id, IdentityProvider.enabled.is_(True))
    )
    provider = result.scalar_one_or_none()
    if not provider:
        return RedirectResponse(f"{frontend}/login?error=provider_missing")

    try:
        discovery = await _discover(provider.issuer_url)
        token_endpoint = discovery["token_endpoint"]
        userinfo_endpoint = discovery.get("userinfo_endpoint")
        redirect_uri = _provider_redirect_uri(provider)

        async with httpx.AsyncClient(timeout=20) as client:
            token_resp = await client.post(
                token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": provider.client_id,
                    "client_secret": decrypt_secret(provider.client_secret_enc),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()
            access = tokens.get("access_token")
            if not access or not userinfo_endpoint:
                raise ValueError("Missing access_token or userinfo_endpoint")
            ui = await client.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {access}"},
            )
            ui.raise_for_status()
            profile = ui.json()
    except Exception:
        return RedirectResponse(f"{frontend}/login?error=oidc_exchange_failed")

    email = _profile_email(profile)
    name = profile.get("name") or profile.get("preferred_username") or email
    if not email:
        return RedirectResponse(f"{frontend}/login?error=email_required")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        if not provider.auto_provision:
            return RedirectResponse(f"{frontend}/login?error=user_not_provisioned")
        user = User(
            email=email,
            name=name,
            hashed_password=None,
            role="member",
            password_set=False,
            is_active=True,
        )
        db.add(user)
        await db.flush()

    membership_result = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == provider.organization_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if not membership:
        if not provider.auto_provision:
            return RedirectResponse(f"{frontend}/login?error=not_a_member")
        role_id = provider.default_role_id
        if not role_id:
            viewer = await db.execute(
                select(Role).where(
                    Role.organization_id == provider.organization_id,
                    Role.name == "Viewer",
                )
            )
            role = viewer.scalar_one_or_none()
            if not role:
                return RedirectResponse(f"{frontend}/login?error=no_default_role")
            role_id = role.id
        db.add(
            Membership(
                user_id=user.id,
                organization_id=provider.organization_id,
                role_id=role_id,
                status="active",
            )
        )
    else:
        membership.status = "active"

    await db.commit()
    pair = await _issue_tokens(db, user)
    # Pass tokens to frontend via fragment-like query (dev-friendly)
    qs = urlencode(
        {
            "access_token": pair.access_token,
            "refresh_token": pair.refresh_token,
            "organization_id": str(provider.organization_id),
        }
    )
    return RedirectResponse(f"{frontend}/login/sso/callback?{qs}")
