"""Microsoft Graph operations used by the Entra tenant onboarding flow."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from uuid import UUID

import httpx


GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
ENTRA_ORGANIZATIONS_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0"


class EntraOnboardingError(RuntimeError):
    """The tenant administrator could not provision the Entra application."""


@dataclass(frozen=True)
class EntraApplication:
    tenant_id: str
    client_id: str
    client_secret: str


def tenant_id_from_id_token(id_token: str) -> str:
    """Read the tenant emitted by the token endpoint after a bound code exchange."""
    try:
        payload_segment = id_token.split(".")[1]
        padded = payload_segment + "=" * (-len(payload_segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        return str(UUID(payload["tid"]))
    except (IndexError, KeyError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EntraOnboardingError("Microsoft Entra did not return a valid tenant identifier") from exc


def application_payload(display_name: str, redirect_uri: str) -> dict:
    return {
        "displayName": display_name,
        "signInAudience": "AzureADMyOrg",
        "web": {"redirectUris": [redirect_uri]},
    }


async def exchange_onboarding_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> tuple[str, str]:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{ENTRA_ORGANIZATIONS_URL}/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "scope": "openid profile https://graph.microsoft.com/Application.ReadWrite.All",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            response.raise_for_status()
            tokens = response.json()
            return tokens["access_token"], tokens["id_token"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EntraOnboardingError("Microsoft Entra could not complete administrator authorization") from exc


async def provision_entra_application(
    access_token: str,
    tenant_id: str,
    display_name: str,
    redirect_uri: str,
) -> EntraApplication:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        application_response = await client.post(
            f"{GRAPH_BASE_URL}/applications",
            headers=headers,
            json=application_payload(display_name, redirect_uri),
        )
        try:
            application_response.raise_for_status()
            application = application_response.json()
            object_id = application["id"]
            client_id = application["appId"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EntraOnboardingError("Microsoft Graph could not create the Entra application") from exc

        secret_response = await client.post(
            f"{GRAPH_BASE_URL}/applications/{object_id}/addPassword",
            headers=headers,
            json={"passwordCredential": {"displayName": "FacuTools SSO"}},
        )
        try:
            secret_response.raise_for_status()
            client_secret = secret_response.json()["secretText"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EntraOnboardingError("Microsoft Graph could not create the application secret") from exc

    return EntraApplication(tenant_id=tenant_id, client_id=client_id, client_secret=client_secret)