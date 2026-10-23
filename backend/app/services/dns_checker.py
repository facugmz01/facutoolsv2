from __future__ import annotations

import asyncio
from urllib.parse import quote

import httpx

from app.services.network_utils import is_valid_domain, normalize_domain

DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "CAA", "PTR", "SRV"]
DKIM_SELECTORS = ["default", "google", "mail", "selector1", "selector2", "k1", "smtp", "dkim"]
CNAME_HOSTS = [
    "autodiscover",
    "enterpriseregistration",
    "enterpriseenrollment",
    *[f"{selector}._domainkey" for selector in DKIM_SELECTORS],
]

PROVIDER_RULES = [
    (lambda ns, _, mx: "cloudflare" in ns, "Cloudflare", "cdn"),
    (lambda ns, _, mx: "awsdns" in ns, "Amazon Route 53", "dns"),
    (lambda ns, _, mx: "googledomains" in ns or "google.com" in ns, "Google Domains", "dns"),
    (lambda ns, _, mx: "godaddy" in ns or "domaincontrol" in ns, "GoDaddy", "registrar"),
    (lambda ns, _, mx: "digitalocean" in ns, "DigitalOcean DNS", "dns"),
    (lambda ns, _, mx: "azure" in ns or "msft" in ns, "Azure DNS", "dns"),
    (lambda ns, _, mx: "ns.cloudns" in ns, "ClouDNS", "dns"),
    (lambda ns, _, mx: "google" in mx or "gmail" in mx, "Google Workspace", "email"),
    (lambda ns, _, mx: "outlook" in mx or "microsoft" in mx or "protection.outlook" in mx, "Microsoft 365", "email"),
    (lambda ns, _, mx: "mimecast" in mx, "Mimecast", "email"),
    (lambda ns, _, mx: "proofpoint" in mx, "Proofpoint", "email"),
]


async def _doh_query(client: httpx.AsyncClient, qname: str, rtype: str) -> dict | None:
    url = f"https://cloudflare-dns.com/dns-query?name={quote(qname)}&type={rtype}"
    try:
        response = await client.get(url, headers={"Accept": "application/dns-json"})
        return response.json()
    except Exception:
        return None


def _parse_record(rtype: str, data: str, ttl: int) -> dict:
    original_data = data
    data = data.rstrip(".")
    if rtype in ("A", "AAAA", "NS", "CNAME", "PTR"):
        return {"value": data, "rdata": original_data, "ttl": ttl}
    if rtype == "MX":
        parts = data.split(" ", 1)
        return {
            "value": parts[1].rstrip(".") if len(parts) > 1 else data,
            "priority": parts[0] if parts else "",
            "rdata": original_data,
            "ttl": ttl,
        }
    if rtype == "TXT":
        return {"value": data, "rdata": original_data, "ttl": ttl}
    if rtype == "SOA":
        parts = data.split()
        return {
            "mname": parts[0].rstrip(".") if parts else "",
            "rname": parts[1].rstrip(".") if len(parts) > 1 else "",
            "serial": parts[2] if len(parts) > 2 else "",
            "refresh": parts[3] if len(parts) > 3 else "",
            "retry": parts[4] if len(parts) > 4 else "",
            "expire": parts[5] if len(parts) > 5 else "",
            "minimum": parts[6] if len(parts) > 6 else "",
            "rdata": original_data,
            "ttl": ttl,
        }
    if rtype == "SRV":
        parts = data.split()
        return {
            "priority": parts[0] if parts else 0,
            "weight": parts[1] if len(parts) > 1 else 0,
            "port": parts[2] if len(parts) > 2 else 0,
            "value": parts[3].rstrip(".") if len(parts) > 3 else "",
            "rdata": original_data,
            "ttl": ttl,
        }
    if rtype == "CAA":
        parts = data.split(" ", 2)
        return {
            "flags": parts[0] if parts else 0,
            "tag": parts[1] if len(parts) > 1 else "",
            "value": parts[2].strip('"') if len(parts) > 2 else "",
            "rdata": original_data,
            "ttl": ttl,
        }
    return {"value": data, "rdata": original_data, "ttl": ttl}


def _extract_records(json_data: dict | None, rtype: str) -> list[dict]:
    if not json_data or not json_data.get("Answer"):
        return []
    type_map = {"A": 1, "AAAA": 28, "MX": 15, "NS": 2, "TXT": 16, "CNAME": 5, "SOA": 6, "CAA": 257, "PTR": 12, "SRV": 33}
    expected = type_map.get(rtype, 0)
    records = []
    for ans in json_data["Answer"]:
        if ans.get("type") != expected:
            continue
        records.append(_parse_record(rtype, ans["data"], ans.get("TTL", 0)))
    return records


def _query_status(json_data: dict | None) -> str:
    if json_data is None:
        return "ERROR"
    if json_data.get("Status") == 3:
        return "NXDOMAIN"
    if json_data.get("Status") not in (None, 0):
        return "ERROR"
    return "NOERROR"


def _collect_cname_records(domain: str, responses: dict[str, dict | None]) -> list[dict]:
    cname_records = []
    query_names = [(domain, "CNAME"), *[(f"{host}.{domain}", f"CNAME_{host}") for host in CNAME_HOSTS]]
    for query_name, response_key in query_names:
        for record in _extract_records(responses.get(response_key), "CNAME"):
            cname_records.append({"name": query_name, **record})
    return cname_records


async def check_dns(domain: str) -> dict:
    domain = normalize_domain(domain)
    if not is_valid_domain(domain):
        raise ValueError(f"Dominio inválido: {domain}")

    async with httpx.AsyncClient(timeout=4) as client:
        queries: dict[str, asyncio.Task] = {}
        for rtype in DNS_TYPES:
            queries[rtype] = asyncio.create_task(_doh_query(client, domain, rtype))
        queries["DMARC"] = asyncio.create_task(_doh_query(client, f"_dmarc.{domain}", "TXT"))
        for sel in DKIM_SELECTORS:
            queries[f"DKIM_{sel}"] = asyncio.create_task(_doh_query(client, f"{sel}._domainkey.{domain}", "TXT"))
        for host in CNAME_HOSTS:
            queries[f"CNAME_{host}"] = asyncio.create_task(_doh_query(client, f"{host}.{domain}", "CNAME"))

        responses = {k: await v for k, v in queries.items()}

    records: dict[str, list] = {}
    queries: dict[str, dict] = {}
    for rtype in DNS_TYPES:
        response = responses.get(rtype)
        parsed = _extract_records(response, rtype)
        queries[rtype] = {
            "name": f"{domain}.",
            "type": rtype,
            "status": _query_status(response),
            "records": parsed,
        }
        if parsed:
            records[rtype] = parsed

    cname_records = _collect_cname_records(domain, responses)
    if cname_records:
        records["CNAME"] = cname_records

    ns_records = [r["value"] for r in records.get("NS", [])]
    txt_records = [r["value"] for r in records.get("TXT", [])]
    a_records = [r["value"] for r in records.get("A", [])]
    mx_records = [r["value"] for r in records.get("MX", [])]

    ns_str = " ".join(ns_records).lower()
    mx_str = " ".join(mx_records).lower()

    providers = []
    for rule, name, ptype in PROVIDER_RULES:
        if rule(ns_str, "", mx_str):
            providers.append({"name": name, "type": ptype})

    has_spf = any("v=spf1" in t.lower() for t in txt_records)
    has_dmarc = False
    dmarc_data = responses.get("DMARC")
    if dmarc_data and dmarc_data.get("Answer"):
        for ans in dmarc_data["Answer"]:
            if "v=DMARC1" in ans.get("data", ""):
                has_dmarc = True
                break

    dkim_found = []
    for sel in DKIM_SELECTORS:
        dkim_data = responses.get(f"DKIM_{sel}")
        if dkim_data and dkim_data.get("Answer"):
            for ans in dkim_data["Answer"]:
                data = ans.get("data", "")
                if "v=DKIM1" in data or "p=" in data:
                    dkim_found.append(sel)
                    break

    return {
        "domain": domain,
        "records": records,
        "cname_records": cname_records,
        "queries": queries,
        "resolver": {"name": "Cloudflare", "protocol": "DoH"},
        "ns": ns_records,
        "server_ip": a_records[0] if a_records else None,
        "providers": providers,
        "email_security": {"spf": has_spf, "dmarc": has_dmarc, "dkim": dkim_found},
        "total_types": len(records),
    }
