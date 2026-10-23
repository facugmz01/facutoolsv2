import asyncio
import base64
import json

from app.services import entra_onboarding


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class _Client:
    def __init__(self):
        self.requests = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, **kwargs):
        self.requests.append((url, kwargs))
        if url.endswith("/applications"):
            return _Response({"id": "object-id", "appId": "client-id"})
        return _Response({"secretText": "new-client-secret"})


def test_provision_entra_application_creates_app_and_secret(monkeypatch):
    client = _Client()
    monkeypatch.setattr(entra_onboarding.httpx, "AsyncClient", lambda **kwargs: client)

    result = asyncio.run(
        entra_onboarding.provision_entra_application(
            "graph-token",
            "11111111-1111-1111-1111-111111111111",
            "FacuTools SSO",
            "https://app.example.com/api/auth/sso/callback",
        )
    )

    assert result.client_id == "client-id"
    assert result.client_secret == "new-client-secret"
    assert client.requests[0][1]["json"] == {
        "displayName": "FacuTools SSO",
        "signInAudience": "AzureADMyOrg",
        "web": {"redirectUris": ["https://app.example.com/api/auth/sso/callback"]},
    }
    assert client.requests[1][0].endswith("/applications/object-id/addPassword")


def test_tenant_id_from_id_token():
    payload = base64.urlsafe_b64encode(
        json.dumps({"tid": "11111111-1111-1111-1111-111111111111"}).encode()
    ).decode().rstrip("=")

    assert entra_onboarding.tenant_id_from_id_token(f"header.{payload}.signature") == "11111111-1111-1111-1111-111111111111"