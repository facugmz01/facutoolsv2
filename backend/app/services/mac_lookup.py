from __future__ import annotations

import re
from urllib.parse import quote

import httpx

from app.settings_store import SettingsStore


def _clean_mac(mac: str) -> str:
    return re.sub(r"[^a-fA-F0-9]", "", mac)


async def lookup_mac(mac: str) -> dict:
    mac = mac.strip()
    mac_clean = _clean_mac(mac)
    if len(mac_clean) < 6:
        raise ValueError("Dirección MAC no válida. Debe contener al menos el prefijo OUI (6 dígitos hex).")

    api_key = SettingsStore.get_str("macvendors_api_key")
    use_api_key = bool(api_key)

    if use_api_key:
        url = f"https://api.macvendors.com/v1/lookup/{quote(mac)}"
        headers = {"Accept": "application/json", "Authorization": f"Bearer {api_key}"}
        source = "macvendors.com V1 (API Key)"
    else:
        url = f"https://api.macvendors.com/{quote(mac)}"
        headers = {"Accept": "application/json"}
        source = "macvendors.com (Público)"

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, headers=headers, follow_redirects=True)

        if use_api_key and response.status_code in (401, 403):
            url = f"https://api.macvendors.com/{quote(mac)}"
            headers = {"Accept": "application/json"}
            source = "macvendors.com (Público)"
            response = await client.get(url, headers=headers)

        if response.status_code == 404:
            raise ValueError("Fabricante no encontrado para la dirección MAC especificada.")
        if response.status_code == 429:
            raise ValueError("Límite de peticiones excedido. Configurá macvendors_api_key en Integraciones.")
        if response.status_code != 200:
            try:
                data = response.json()
                msg = data.get("message") or data.get("error") or "Error desconocido de MACVendors"
            except Exception:
                msg = f"Error HTTP {response.status_code}"
            raise ValueError(msg)

        if use_api_key and source.endswith("(API Key)"):
            data = response.json()
            vendor = (
                (data.get("data") or {}).get("organization_name")
                or (data.get("data") or {}).get("vendor")
                or (data.get("data") or {}).get("company")
                or data.get("vendor")
                or "Desconocido"
            )
        else:
            vendor = response.text.strip()

        oui = ":".join(mac_clean[i:i + 2].upper() for i in range(0, min(6, len(mac_clean)), 2))

        return {
            "mac": mac,
            "vendor": vendor,
            "oui": oui,
            "source": source,
        }
