from __future__ import annotations

import asyncio
import socket

import httpx

from app.services.network_utils import is_valid_domain, is_valid_ipv4, normalize_domain
from app.settings_store import SettingsStore

IPDATA_FIELDS = ",".join([
    "ip", "is_eu",
    "continent_name", "continent_code",
    "country_name", "country_code",
    "flag", "emoji_flag",
    "region", "region_code", "region_type",
    "city", "postal", "calling_code",
    "latitude", "longitude",
    "time_zone", "currency", "asn", "threat",
])


async def resolve_to_ip(value: str) -> str:
    value = value.strip()
    if is_valid_ipv4(value):
        return value
    domain = normalize_domain(value)
    if not is_valid_domain(domain):
        raise ValueError("IP o dominio inválido")
    resolved = await asyncio.to_thread(socket.gethostbyname, domain)
    if not is_valid_ipv4(resolved):
        raise ValueError(f"No se pudo resolver el dominio: {value}")
    return resolved


async def lookup_ip(ip: str | None = None, client_ip: str | None = None) -> dict:
    api_key = SettingsStore.get_str("ipdata_api_key")
    if not api_key:
        raise ValueError("ipdata_api_key no configurada. Revisá Configuración → Integraciones")

    target = ip
    if target:
        target = await resolve_to_ip(target)
    elif client_ip and is_valid_ipv4(client_ip):
        target = client_ip
    else:
        raise ValueError("No se pudo determinar la IP del cliente")

    url = f"https://api.ipdata.co/{target}"
    params = {"api-key": api_key, "fields": IPDATA_FIELDS}

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            detail = response.json().get("message", response.text) if response.content else response.status_code
            raise ValueError(f"Error de ipdata.co: {detail}")
        return response.json()
