from __future__ import annotations

import asyncio
import json
import re
from uuid import uuid4

import dns.asyncresolver
import dns.exception
import dns.resolver
import httpx

from app.schemas import SubdomainResult
from app.services.network_utils import is_valid_domain, normalize_domain

MAX_CERTIFICATE_BYTES = 5_000_000
MAX_CANDIDATES = 120
RELATED_DNS_TYPES = ("NS", "MX", "SRV", "CNAME", "TXT")


async def _certificate_names(domain: str) -> tuple[set[str], bool]:
    content = bytearray()
    async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5)) as client:
        last_error: Exception | None = None
        for _ in range(2):
            content.clear()
            try:
                async with client.stream("GET", "https://crt.sh/", params={"q": f"%.{domain}", "output": "json"}) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_CERTIFICATE_BYTES:
                            raise ValueError("Certificate response too large")
                break
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
        else:
            raise last_error or ValueError("Certificate source unavailable")
    records = json.loads(content)
    if not isinstance(records, list):
        raise ValueError("Invalid certificate response")
    names = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        for name in str(record.get("name_value", "")).splitlines():
            name = name.strip().lower().rstrip(".")
            if name.startswith("*."):
                continue
            if name.endswith(f".{domain}") and len(name) <= 253 and is_valid_domain(name):
                names.add(name)
    return set(sorted(names)[:MAX_CANDIDATES]), len(names) > MAX_CANDIDATES


async def _resolve_candidate(resolver: dns.asyncresolver.Resolver, hostname: str) -> dict:
    async def query(record_type: str):
        try:
            answer = await resolver.resolve(hostname, record_type, lifetime=3, search=False)
            addresses = sorted({str(record) for record in answer})
            canonical = str(answer.canonical_name).rstrip(".").lower()
            return addresses, canonical if canonical != hostname else None, None
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return [], None, None
        except (dns.exception.DNSException, OSError):
            return [], None, "dns_error"

    ipv4, ipv6 = await asyncio.gather(query("A"), query("AAAA"))
    addresses = ipv4[0] + ipv6[0]
    return {
        "subdomain": hostname,
        "ips": addresses,
        "ipv4": ipv4[0],
        "ipv6": ipv6[0],
        "cname": ipv4[1] or ipv6[1],
        "active": bool(addresses),
        "status": "resolved" if addresses else "dns_error" if ipv4[2] or ipv6[2] else "no_address",
        "dns_partial": bool(ipv4[2] or ipv6[2]),
        "wildcard": False,
    }


def _candidate_from_value(value: str, domain: str) -> str | None:
    candidate = value.strip().strip('"').rstrip(".").lower()
    if candidate.startswith("*."):
        candidate = candidate[2:]
    if candidate == domain or not candidate.endswith(f".{domain}"):
        return None
    if len(candidate) > 253 or not is_valid_domain(candidate):
        return None
    return candidate


async def _dns_related_names(
    resolver: dns.asyncresolver.Resolver, domain: str
) -> tuple[set[str], bool]:
    """Extract in-domain hostnames referenced by the domain's DNS records."""
    names: set[str] = set()
    failed_queries = 0
    attempted_queries = 0

    async def query(record_type: str):
        try:
            return record_type, await resolver.resolve(domain, record_type, lifetime=3, search=False)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return record_type, []
        except (dns.exception.DNSException, OSError):
            return record_type, None

    responses = await asyncio.gather(*(query(record_type) for record_type in RELATED_DNS_TYPES))
    for record_type, answers in responses:
        attempted_queries += 1
        if answers is None:
            failed_queries += 1
            continue
        for answer in answers:
            if record_type == "SRV":
                values = [str(answer.target)]
            elif record_type == "TXT":
                values = re.findall(
                    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+" + re.escape(domain),
                    str(answer).lower(),
                )
            elif record_type == "MX":
                values = [str(answer.exchange)]
            else:
                values = [str(answer)]
            for value in values:
                candidate = _candidate_from_value(value, domain)
                if candidate:
                    names.add(candidate)
    return names, attempted_queries > 0 and failed_queries == attempted_queries


async def discover(domain: str, common_names: list[str], include_certificates: bool = False) -> SubdomainResult:
    domain = normalize_domain(domain)
    if len(domain) > 253 or not is_valid_domain(domain):
        raise ValueError("Invalid domain")
    resolver = dns.asyncresolver.Resolver()
    semaphore = asyncio.Semaphore(10)
    warnings: list[str] = []
    candidates = {f"{name}.{domain}": ["common"] for name in common_names}

    async def resolve(hostname: str):
        async with semaphore:
            return await _resolve_candidate(resolver, hostname)

    async def certificates():
        if not include_certificates:
            return set(), False
        try:
            return await asyncio.wait_for(_certificate_names(domain), timeout=25)
        except (httpx.HTTPError, ValueError, asyncio.TimeoutError):
            warnings.append("certificate_source_unavailable")
            return set(), False

    certificate_result, probes = await asyncio.gather(
        certificates(),
        asyncio.gather(*(resolve(f"{uuid4().hex}.{domain}") for _ in range(2))),
    )
    dns_names, dns_failed = await _dns_related_names(resolver, domain)
    dns_truncated = False
    if dns_failed:
        warnings.append("dns_source_unavailable")
    for name in sorted(dns_names):
        if name not in candidates and len(candidates) >= MAX_CANDIDATES:
            dns_truncated = True
            continue
        candidates.setdefault(name, []).append("dns")
    names, truncated = certificate_result
    truncated = truncated or dns_truncated
    for name in sorted(names):
        if name not in candidates and len(candidates) >= MAX_CANDIDATES:
            truncated = True
            continue
        candidates.setdefault(name, []).append("certificate")

    wildcard_ips = set(probes[0]["ips"]) | set(probes[1]["ips"])
    wildcard_detected = all(probe["active"] for probe in probes)
    if any(probe["dns_partial"] for probe in probes):
        warnings.append("wildcard_check_incomplete")
    wildcard_cnames = {probe["cname"] for probe in probes if probe["cname"]}
    results = await asyncio.gather(*(resolve(hostname) for hostname in candidates))
    found = []
    excluded = 0
    if truncated:
        warnings.append("candidate_limit_reached")
    if any(result["dns_partial"] for result in results):
        warnings.append("dns_checks_incomplete")
    for result in results:
        result["sources"] = candidates[result["subdomain"]]
        result["wildcard"] = bool(wildcard_detected and result["active"] and (
            set(result["ips"]).issubset(wildcard_ips) or result["cname"] in wildcard_cnames
        ))
        if result["wildcard"] and "certificate" not in result["sources"]:
            excluded += 1
            continue
        if result["active"] or "certificate" in result["sources"]:
            found.append(result)
    found.sort(key=lambda result: (not result["active"], result["subdomain"]))
    return SubdomainResult(
        domain=domain, subdomains=found, total_found=len(found),
        total_checked=len(candidates), resolved_count=sum(result["active"] for result in found),
        wildcard_detected=wildcard_detected, wildcard_filtered=excluded,
        warnings=warnings,
    )