from datetime import datetime, timezone
from types import SimpleNamespace

from app.routers.sso import _api_public_base, _frontend_url, _profile_email, _provider_out
from app.settings_store import SettingsStore


def test_sso_urls_are_normalized(monkeypatch):
    monkeypatch.setattr(
        SettingsStore,
        "_cache",
        {
            "cors_origins": ["https://app.example.com/"],
            "api_public_url": "https://api.example.com/",
        },
    )

    assert _frontend_url() == "https://app.example.com"
    assert _api_public_base() == "https://api.example.com/"


def test_provider_output_does_not_include_secret():
    provider = SimpleNamespace(
        id=7,
        name="Company SSO",
        type="oidc",
        issuer_url="https://issuer.example.com",
        client_id="client-id",
        scopes="openid email profile",
        enabled=True,
        auto_provision=False,
        default_role_id=2,
        created_at=datetime.now(timezone.utc),
    )

    result = _provider_out(provider)

    assert result.id == 7
    assert result.client_id == "client-id"
    assert "client_secret" not in result.model_dump()


def test_sso_profile_uses_entra_preferred_username_when_email_is_unavailable():
    assert _profile_email({"preferred_username": "user@contoso.com"}) == "user@contoso.com"
    assert _profile_email({"email": "User@contoso.com", "preferred_username": "other@contoso.com"}) == "user@contoso.com"