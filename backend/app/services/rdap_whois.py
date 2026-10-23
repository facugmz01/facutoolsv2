from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import quote

import httpx

from app.services.network_utils import is_valid_domain, normalize_domain
from app.settings_store import SettingsStore

STATUS_LABELS = {
    "active": ("Activo", "ok"),
    "inactive": ("Inactivo", "warn"),
    "client delete prohibited": ("Borrado bloqueado (cliente)", "ok"),
    "client transfer prohibited": ("Transferencia bloqueada", "ok"),
    "client update prohibited": ("Actualización bloqueada", "ok"),
    "client hold": ("En espera (cliente)", "warn"),
    "server delete prohibited": ("Borrado bloqueado (servidor)", "ok"),
    "server transfer prohibited": ("Transferencia bloqueada (srv)", "ok"),
    "server update prohibited": ("Actualización bloqueada (srv)", "ok"),
    "server hold": ("En espera (servidor)", "warn"),
    "pending delete": ("Pendiente de borrado", "danger"),
    "pending restore": ("Pendiente de restauración", "warn"),
    "pending transfer": ("Transferencia pendiente", "warn"),
    "pending update": ("Actualización pendiente", "warn"),
    "pending create": ("Creación pendiente", "warn"),
    "redemption period": ("Período de redención", "danger"),
    "add period": ("Período de alta", "ok"),
    "auto renew period": ("Renovación automática", "ok"),
    "transfer period": ("En transferencia", "warn"),
}


def _is_ar_domain(domain: str) -> bool:
    return bool(re.search(r"\.ar$", domain, re.I))


def _parse_vcard(vcard_array: list) -> dict:
    result = {}
    if len(vcard_array) < 2 or not isinstance(vcard_array[1], list):
        return result
    for prop in vcard_array[1]:
        if not isinstance(prop, list) or len(prop) < 4:
            continue
        name, _, _, value = prop[0], prop[1], prop[2], prop[3]
        if name == "fn":
            result["name"] = value
        elif name == "org":
            result["org"] = ", ".join(value) if isinstance(value, list) else value
        elif name == "email":
            result["email"] = value
        elif name == "tel":
            result["tel"] = value
        elif name == "adr" and isinstance(value, list):
            result["address"] = ", ".join(p for p in value[2:] if p)
    return result


def _parse_entities(entities: list) -> dict:
    result = {}
    for entity in entities:
        roles = entity.get("roles", [])
        vcard = _parse_vcard(entity.get("vcardArray", []))
        handle = entity.get("handle")
        iana_id = None
        for pid in entity.get("publicIds", []):
            if pid.get("type") == "IANA Registrar ID":
                iana_id = pid.get("identifier")
        for role in roles:
            result[role] = {k: v for k, v in {
                "handle": handle, "iana_id": iana_id,
                "name": vcard.get("name"), "org": vcard.get("org"),
                "email": vcard.get("email"), "tel": vcard.get("tel"),
                "address": vcard.get("address"),
            }.items() if v}
    return result


def _parse_events(events: list) -> dict:
    dates = {}
    for event in events:
        action = event.get("eventAction", "")
        date_str = event.get("eventDate", "")
        if not date_str:
            continue
        for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                dt = datetime.strptime(date_str.replace("+00:00", "Z"), fmt)
                dates[action] = dt.strftime("%Y-%m-%d %H:%M:%S UTC")
                break
            except ValueError:
                continue
        else:
            dates[action] = date_str
    return dates


def _parse_status(statuses: list) -> list:
    return [
        {
            "raw": s,
            "label": STATUS_LABELS.get(s.lower(), (s, "dim"))[0],
            "type": STATUS_LABELS.get(s.lower(), (s, "dim"))[1],
        }
        for s in statuses
    ]


def _days_until_expiry(expiry_str: str) -> int | None:
    clean = expiry_str.split("T")[0].split(" ")[0]
    try:
        expiry = datetime.strptime(clean, "%Y-%m-%d")
        diff = (expiry - datetime.utcnow()).days
        return diff
    except ValueError:
        return None


async def _rdap_query(url: str) -> dict:
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        response = await client.get(url, headers={
            "Accept": "application/rdap+json, application/json",
            "User-Agent": "FacuTools/1.0 (RDAP lookup)",
        })
        if response.status_code == 404:
            return {"_error": "Dominio no encontrado en el registro.", "_code": 404}
        if response.status_code != 200:
            return {"_error": f"El servidor RDAP respondió con código {response.status_code}.", "_code": response.status_code}
        data = response.json()
        if not data:
            return {"_error": "Respuesta inválida del servidor RDAP.", "_code": response.status_code}
        return data


async def _domscan_failover(domain: str) -> dict | None:
    api_key = SettingsStore.get_str("domscan_api_key")
    if not api_key:
        return None
    url = f"https://api.domscan.net/v1/whois?domain={quote(domain)}"
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.get(url, headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
        if response.status_code != 200:
            return None
        ds_data = response.json()
        if "data" in ds_data:
            ds_data = ds_data["data"]
        if not ds_data or ds_data.get("error"):
            return None

        whois = ds_data.get("whois", ds_data)
        nameservers = whois.get("nameservers", ds_data.get("nameservers", []))
        if not isinstance(nameservers, list):
            nameservers = [nameservers]

        events = {}
        for src, dst in [
            ("created_date", "registration"), ("creation_date", "registration"),
            ("updated_date", "last changed"),
            ("expires_date", "expiration"), ("expiration_date", "expiration"),
        ]:
            if whois.get(src) and dst not in events:
                events[dst] = whois[src]

        entities = {}
        if whois.get("registrar"):
            reg = whois["registrar"]
            entities["registrar"] = {"name": reg["name"] if isinstance(reg, dict) else reg}

        statuses = []
        if whois.get("status"):
            st = whois["status"]
            statuses = _parse_status(st if isinstance(st, list) else [st])

        days_expiry = _days_until_expiry(events["expiration"]) if events.get("expiration") else None

        return {
            "source": "DOMSCAN.net (Failover)",
            "rdap_url": url,
            "handle": None,
            "ldhName": domain,
            "status": statuses,
            "nameservers": [ns.lower() for ns in nameservers if ns],
            "dnssec": whois.get("dnssec", False),
            "events": events,
            "days_expiry": days_expiry,
            "entities": entities,
        }


async def lookup_rdap(domain: str) -> dict:
    domain = normalize_domain(domain)
    if not is_valid_domain(domain):
        raise ValueError(f"Dominio inválido: {domain}")

    is_ar = _is_ar_domain(domain)
    source = "NIC Argentina (RDAP)" if is_ar else "RDAP Bootstrap (rdap.org)"
    rdap_url = f"https://rdap.nic.ar/domain/{domain}" if is_ar else f"https://rdap.org/domain/{domain}"

    raw = await _rdap_query(rdap_url)

    if "_error" in raw:
        failover = await _domscan_failover(domain)
        if failover:
            return {"domain": domain, "is_ar": is_ar, **failover}
        raise ValueError(raw["_error"])

    nameservers = [
        (ns.get("ldhName") or ns.get("unicodeName") or "").lower()
        for ns in raw.get("nameservers", [])
    ]
    entities = _parse_entities(raw.get("entities", []))
    events = _parse_events(raw.get("events", []))
    statuses = _parse_status(raw.get("status", []))
    dnssec = (raw.get("secureDNS") or {}).get("delegationSigned", False)
    days_expiry = _days_until_expiry(events["expiration"]) if events.get("expiration") else None

    return {
        "domain": domain,
        "source": source,
        "is_ar": is_ar,
        "rdap_url": rdap_url,
        "handle": raw.get("handle"),
        "ldhName": raw.get("ldhName", domain),
        "status": statuses,
        "nameservers": [ns for ns in nameservers if ns],
        "dnssec": dnssec,
        "events": events,
        "days_expiry": days_expiry,
        "entities": entities,
    }
