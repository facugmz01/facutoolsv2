from __future__ import annotations

import asyncio
import time

import dns.resolver

from app.services.network_utils import is_valid_domain, normalize_domain

DNS_SERVERS = [
    {"ip": "8.8.8.8", "name": "Google", "location": "Global", "flag": "🌐"},
    {"ip": "8.8.4.4", "name": "Google Secondary", "location": "Global", "flag": "🌐"},
    {"ip": "1.1.1.1", "name": "Cloudflare", "location": "Global", "flag": "🌐"},
    {"ip": "1.0.0.1", "name": "Cloudflare Alt", "location": "Global", "flag": "🌐"},
    {"ip": "208.67.222.222", "name": "OpenDNS", "location": "US", "flag": "🇺🇸"},
    {"ip": "208.67.220.220", "name": "OpenDNS Alt", "location": "US", "flag": "🇺🇸"},
    {"ip": "9.9.9.9", "name": "Quad9", "location": "Global", "flag": "🌐"},
    {"ip": "149.112.112.112", "name": "Quad9 Alt", "location": "Global", "flag": "🌐"},
    {"ip": "45.90.28.230", "name": "NextDNS", "location": "Global", "flag": "🌐"},
    {"ip": "185.222.222.222", "name": "DNS.SB", "location": "Global", "flag": "🌐"},
    {"ip": "76.76.2.0", "name": "ControlD", "location": "Global", "flag": "🌐"},
    {"ip": "200.221.11.100", "name": "Registro.br", "location": "Brasil", "flag": "🇧🇷"},
    {"ip": "185.228.168.9", "name": "CleanBrowsing", "location": "Europa", "flag": "🇪🇺"},
    {"ip": "77.88.8.8", "name": "Yandex DNS", "location": "Rusia", "flag": "🇷🇺"},
    {"ip": "195.46.39.39", "name": "SafeDNS", "location": "Europa", "flag": "🇪🇺"},
    {"ip": "168.126.63.1", "name": "KT DNS", "location": "Corea del Sur", "flag": "🇰🇷"},
    {"ip": "101.226.4.6", "name": "DNSPod China", "location": "China", "flag": "🇨🇳"},
    {"ip": "114.114.114.114", "name": "114DNS", "location": "China", "flag": "🇨🇳"},
    {"ip": "5.11.11.5", "name": "Liquid Telecom", "location": "Sudáfrica", "flag": "🇿🇦"},
    {"ip": "4.2.2.2", "name": "Level3 Lumen", "location": "US", "flag": "🇺🇸"},
    {"ip": "94.140.14.14", "name": "AdGuard DNS", "location": "Global", "flag": "🌐"},
]

ALLOWED_TYPES = {"A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"}


def _query_resolver(server: dict, domain: str, record_type: str) -> dict:
    start = time.time()
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [server["ip"]]
    resolver.lifetime = 3
    try:
        answers = resolver.resolve(domain, record_type)
        values = sorted(str(r).rstrip(".") for r in answers)
        ms = round((time.time() - start) * 1000)
        return {
            "server": server["name"], "ip": server["ip"], "location": server["location"],
            "flag": server["flag"], "values": values, "raw": " · ".join(values),
            "error": False, "ms": ms, "status": "ok",
        }
    except dns.resolver.NXDOMAIN:
        ms = round((time.time() - start) * 1000)
        return {
            "server": server["name"], "ip": server["ip"], "location": server["location"],
            "flag": server["flag"], "values": [], "raw": "NXDOMAIN",
            "error": False, "ms": ms, "status": "nxdomain",
        }
    except dns.resolver.NoAnswer:
        ms = round((time.time() - start) * 1000)
        return {
            "server": server["name"], "ip": server["ip"], "location": server["location"],
            "flag": server["flag"], "values": [], "raw": "NODATA",
            "error": False, "ms": ms, "status": "nodata",
        }
    except Exception:
        ms = round((time.time() - start) * 1000)
        return {
            "server": server["name"], "ip": server["ip"], "location": server["location"],
            "flag": server["flag"], "values": [], "raw": "",
            "error": True, "ms": ms, "status": "error",
        }


async def check_propagation(domain: str, record_type: str = "A") -> dict:
    domain = normalize_domain(domain)
    if not is_valid_domain(domain):
        raise ValueError("Dominio inválido")
    record_type = record_type.upper()
    if record_type not in ALLOWED_TYPES:
        raise ValueError(f"Tipo inválido. Permitidos: {', '.join(sorted(ALLOWED_TYPES))}")

    start = time.time()
    tasks = [
        asyncio.to_thread(_query_resolver, srv, domain, record_type)
        for srv in DNS_SERVERS
    ]
    results = await asyncio.gather(*tasks)
    total_ms = round((time.time() - start) * 1000)

    ok_results = [r for r in results if r["status"] == "ok"]
    all_values = {",".join(r["values"]) for r in ok_results}
    consistent = len(all_values) <= 1
    propagated = len(ok_results)

    return {
        "domain": domain,
        "type": record_type,
        "propagated": propagated,
        "total": len(results),
        "consistent": consistent,
        "pct": round(propagated / len(results) * 100) if results else 0,
        "total_ms": total_ms,
        "results": results,
    }
