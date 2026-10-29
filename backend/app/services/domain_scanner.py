from __future__ import annotations

import asyncio
import socket
import ssl
from datetime import datetime, timezone
from urllib.parse import urlparse

import dns.resolver
import httpx
import whois

from app.schemas import (
    BlacklistResult,
    DNSRecord,
    EmailSecurityReport,
    PropagationResult,
    SSLInfo,
    SubdomainResult,
    TechStackResult,
    WHOISInfo,
)

COMMON_SUBDOMAINS = [
    "www", "mail", "ftp", "admin", "api", "dev", "staging", "test",
    "blog", "shop", "cdn", "app", "portal", "vpn", "ns1", "ns2",
    "mx", "smtp", "webmail", "support", "docs", "status",
]

BLACKLISTS = [
    "zen.spamhaus.org",
    "bl.spamcop.net",
    "dnsbl.sorbs.net",
    "b.barracudacentral.org",
]

PUBLIC_DNS_RESOLVERS = [
    ("8.8.8.8", "Google DNS", "US"),
    ("1.1.1.1", "Cloudflare", "US"),
    ("9.9.9.9", "Quad9", "US"),
    ("208.67.222.222", "OpenDNS", "US"),
    ("185.228.168.9", "CleanBrowsing", "EU"),
]


def _parse_date(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, list):
        for item in value:
            parsed = _parse_date(item)
            if parsed:
                return parsed
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, str):
        clean = value.strip().replace(" UTC", "")
        if not clean:
            return None
        iso_value = clean.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(iso_value)
            return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(clean[:19] if len(clean) >= 19 else clean[:10], fmt)
            except ValueError:
                continue
    return None


_REGISTRAR_HANDLE_LABELS = {
    "nicar": "NIC Argentina",
}


def _clean_text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        for item in value:
            text = _clean_text(item)
            if text:
                return text
    return None


def _entity_text(entity, keys: tuple[str, ...]) -> str | None:
    if isinstance(entity, dict):
        for key in keys:
            text = _clean_text(entity.get(key))
            if text:
                return text
        return None
    return _clean_text(entity)


def _registrar_label(value: str | None) -> str | None:
    if not value:
        return None
    return _REGISTRAR_HANDLE_LABELS.get(value.lower(), value)


def _registrar_from_rdap(rdap_data: dict) -> str | None:
    entities = rdap_data.get("entities") or {}
    registrar_candidates = [
        entities.get("registrar") if isinstance(entities, dict) else None,
        entities.get("sponsor") if isinstance(entities, dict) else None,
        rdap_data.get("registrar"),
        rdap_data.get("registrarName"),
        rdap_data.get("registrar_name"),
    ]
    primary_keys = ("name", "org", "registrar", "registrarName", "registrar_name", "fn")
    fallback_keys = ("handle", "iana_id", "ianaId", "id")

    for candidate in registrar_candidates:
        text = _entity_text(candidate, primary_keys)
        if text:
            return _registrar_label(text)
    for candidate in registrar_candidates:
        text = _entity_text(candidate, fallback_keys)
        if text:
            return _registrar_label(text)
    if rdap_data.get("is_ar") or rdap_data.get("source") == "NIC Argentina (RDAP)":
        return "NIC Argentina"
    return None


async def fetch_whois(domain: str) -> WHOISInfo | None:
    try:
        data = await asyncio.to_thread(whois.whois, domain)
        if not data or not data.domain_name:
            return None
        return WHOISInfo(
            registrar=data.registrar,
            creation_date=_parse_date(data.creation_date),
            expiration_date=_parse_date(data.expiration_date),
            updated_date=_parse_date(data.updated_date),
            name_servers=[str(ns).lower() for ns in (data.name_servers or []) if ns],
            status=[str(s) for s in (data.status or []) if s],
            registrant=getattr(data, "org", None) or getattr(data, "name", None),
        )
    except Exception:
        return None


async def fetch_dns(domain: str) -> list[DNSRecord]:
    records: list[DNSRecord] = []
    record_types = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"]
    for rtype in record_types:
        try:
            answers = await asyncio.to_thread(
                dns.resolver.resolve, domain, rtype, lifetime=5
            )
            for rdata in answers:
                records.append(DNSRecord(type=rtype, name=domain, value=str(rdata), ttl=answers.ttl))
        except Exception:
            continue
    return records


def _connect_tls(domain: str, port: int, *, verify: bool) -> tuple[bytes, str | None, tuple | None]:
    """Open a TLS connection and return (leaf_der, negotiated_protocol, cipher)."""
    context = ssl.create_default_context()
    if not verify:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    with socket.create_connection((domain, port), timeout=10) as sock:
        with context.wrap_socket(sock, server_hostname=domain) as ssock:
            return ssock.getpeercert(binary_form=True), ssock.version(), ssock.cipher()


def _connection_error_message(domain: str, exc: Exception) -> str:
    if isinstance(exc, socket.gaierror):
        return f"No se pudo resolver el dominio: {domain}"
    if isinstance(exc, TimeoutError):
        return f"Tiempo de espera agotado al conectar con {domain}:443"
    if isinstance(exc, ConnectionRefusedError):
        return f"Conexión rechazada en {domain}:443 (¿el puerto 443 está abierto?)"
    if isinstance(exc, ssl.SSLError):
        return f"No se pudo establecer el canal TLS con {domain}: {exc}"
    return f"No se pudo conectar a {domain}:443: {exc}"


async def fetch_ssl(domain: str) -> SSLInfo:
    """Fetch the leaf certificate for a hostname, tolerating untrusted/self-signed chains.

    Raises ValueError when the host cannot be reached or no TLS handshake succeeds at all.
    """
    from cryptography import x509
    from app.services.x509_utils import is_self_signed, public_key_info, subject_alt_names

    try:
        der, protocol, cipher = await asyncio.to_thread(_connect_tls, domain, 443, verify=False)
    except Exception as exc:
        raise ValueError(_connection_error_message(domain, exc)) from exc

    cert = x509.load_der_x509_certificate(der)

    trusted = True
    trust_error: str | None = None
    try:
        await asyncio.to_thread(_connect_tls, domain, 443, verify=True)
    except ssl.SSLCertVerificationError as exc:
        trusted, trust_error = False, getattr(exc, "verify_message", None) or str(exc)
    except Exception as exc:
        trusted, trust_error = False, str(exc)

    now = datetime.now(timezone.utc)
    days_remaining = (cert.not_valid_after_utc - now).days
    key_type, key_bits = public_key_info(cert)

    return SSLInfo(
        issuer=cert.issuer.rfc4514_string(),
        subject=cert.subject.rfc4514_string(),
        valid_from=cert.not_valid_before_utc,
        valid_until=cert.not_valid_after_utc,
        days_remaining=days_remaining,
        is_valid=cert.not_valid_before_utc <= now <= cert.not_valid_after_utc,
        protocol=protocol,
        cipher=cipher[0] if cipher else None,
        sans=subject_alt_names(cert),
        serial_number=format(cert.serial_number, "x"),
        signature_algorithm=cert.signature_hash_algorithm.name if cert.signature_hash_algorithm else None,
        key_type=key_type,
        key_bits=key_bits,
        is_self_signed=is_self_signed(cert),
        trusted=trusted,
        trust_error=trust_error,
    )


async def fetch_ssl_or_none(domain: str) -> SSLInfo | None:
    """Same as fetch_ssl but swallows connectivity errors for aggregate scans."""
    try:
        return await fetch_ssl(domain)
    except ValueError:
        return None


async def check_health(domain: str, method: str = "http", port: int | None = None) -> dict:
    if method != "http":
        from app.services import verification_checks as vc

        if method == "ping":
            result = await vc.check_ping(domain)
        elif method == "tcp":
            result = await vc.check_tcp_port(domain, port or 443)
        elif method == "ssl":
            result = await vc.check_ssl(domain, port or 443)
        elif method == "dns":
            started = datetime.utcnow()
            try:
                await asyncio.to_thread(dns.resolver.resolve, domain, "A", lifetime=5)
                ok = True
            except Exception:
                ok = False
            elapsed = (datetime.utcnow() - started).total_seconds() * 1000
            return {"is_up": ok, "status_code": None, "response_time_ms": round(elapsed, 2) if ok else None, "final_url": None}
        else:
            result = None
        if result is not None:
            is_up = result["status"] != "DOWN"
            return {
                "is_up": is_up,
                "status_code": None,
                "response_time_ms": result["latency_ms"] if is_up else None,
                "final_url": None,
            }
    url = f"https://{domain}"
    start = datetime.utcnow()
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url)
            elapsed = (datetime.utcnow() - start).total_seconds() * 1000
            return {
                "is_up": response.status_code < 500,
                "status_code": response.status_code,
                "response_time_ms": round(elapsed, 2),
                "final_url": str(response.url),
            }
    except Exception:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                response = await client.get(f"http://{domain}")
                elapsed = (datetime.utcnow() - start).total_seconds() * 1000
                return {
                    "is_up": response.status_code < 500,
                    "status_code": response.status_code,
                    "response_time_ms": round(elapsed, 2),
                    "final_url": str(response.url),
                }
        except Exception:
            return {"is_up": False, "status_code": None, "response_time_ms": None, "final_url": None}


async def analyze_email_security(domain: str) -> EmailSecurityReport:
    recommendations: list[str] = []
    score = 100

    spf_result = {"found": False, "record": None, "valid": False}
    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, domain, "TXT", lifetime=5)
        for rdata in answers:
            txt = str(rdata).strip('"')
            if txt.lower().startswith("v=spf1"):
                spf_result = {"found": True, "record": txt, "valid": "~all" in txt or "-all" in txt}
                if not spf_result["valid"]:
                    recommendations.append("SPF record should end with ~all or -all")
                    score -= 15
                break
        if not spf_result["found"]:
            recommendations.append("No SPF record found")
            score -= 25
    except Exception:
        recommendations.append("No SPF record found")
        score -= 25

    dmarc_result = {"found": False, "record": None, "policy": None}
    try:
        answers = await asyncio.to_thread(
            dns.resolver.resolve, f"_dmarc.{domain}", "TXT", lifetime=5
        )
        for rdata in answers:
            txt = str(rdata).strip('"')
            if txt.lower().startswith("v=dmarc1"):
                policy = "none"
                for part in txt.split(";"):
                    key, _, value = part.strip().partition("=")
                    if key.lower() == "p":
                        policy = value.strip().lower()
                dmarc_result = {"found": True, "record": txt, "policy": policy}
                if policy == "none":
                    recommendations.append("DMARC policy is 'none' - consider upgrading to quarantine or reject")
                    score -= 10
                break
        if not dmarc_result["found"]:
            recommendations.append("No DMARC record found")
            score -= 25
    except Exception:
        recommendations.append("No DMARC record found")
        score -= 25

    dkim_result = {"found": False, "selectors": []}
    for selector in ["default", "google", "selector1", "selector2", "k1", "s1", "dkim"]:
        try:
            answers = await asyncio.to_thread(
                dns.resolver.resolve, f"{selector}._domainkey.{domain}", "TXT", lifetime=3
            )
            dkim_result["selectors"].append(selector)
            dkim_result["found"] = True
        except Exception:
            continue
    if not dkim_result["found"]:
        recommendations.append("No DKIM records found for common selectors")
        score -= 20

    mx_records: list[str] = []
    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, domain, "MX", lifetime=5)
        mx_records = [str(r.exchange) for r in answers]
    except Exception:
        recommendations.append("No MX records found")
        score -= 15

    return EmailSecurityReport(
        domain=domain,
        spf=spf_result,
        dkim=dkim_result,
        dmarc=dmarc_result,
        mx_records=mx_records,
        score=max(0, score),
        recommendations=recommendations,
    )


async def check_dns_propagation(domain: str, record_type: str = "A") -> list[PropagationResult]:
    results: list[PropagationResult] = []
    reference: set[str] = set()

    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, domain, record_type, lifetime=5)
        reference = {str(r) for r in answers}
    except Exception:
        pass

    for ip, name, location in PUBLIC_DNS_RESOLVERS:
        try:
            resolver = dns.resolver.Resolver()
            resolver.nameservers = [ip]
            resolver.lifetime = 5
            answers = await asyncio.to_thread(resolver.resolve, domain, record_type)
            records = [str(r) for r in answers]
            results.append(PropagationResult(
                resolver=name,
                location=location,
                records=records,
                propagated=bool(reference) and set(records) == reference,
            ))
        except Exception:
            results.append(PropagationResult(
                resolver=name, location=location, records=[], propagated=False
            ))
    return results


async def detect_tech_stack(domain: str) -> TechStackResult:
    technologies: list[dict] = []
    server = cms = cdn = None
    analytics: list[str] = []
    page: tuple[str, str, dict[str, str]] | None = None

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(f"https://{domain}")
            headers = response.headers
            body = response.text.lower()
            page = (str(response.url), response.text, dict(headers))

            server = headers.get("server")
            if server:
                technologies.append({"name": server, "category": "Web Server"})

            if "x-powered-by" in headers:
                technologies.append({"name": headers["x-powered-by"], "category": "Framework"})

            cdn_headers = ["cf-ray", "x-cdn", "x-cache", "x-served-by"]
            for h in cdn_headers:
                if h in headers:
                    cdn = "Cloudflare" if h == "cf-ray" else headers.get(h, "CDN detected")
                    technologies.append({"name": cdn, "category": "CDN"})
                    break

            cms_signatures = {
                "wordpress": "WordPress", "drupal": "Drupal", "joomla": "Joomla",
                "shopify": "Shopify", "wix": "Wix", "squarespace": "Squarespace",
                "next.js": "Next.js", "react": "React", "vue": "Vue.js",
            }
            for sig, name in cms_signatures.items():
                if sig in body or sig in str(headers).lower():
                    cms = name
                    technologies.append({"name": name, "category": "CMS/Framework"})

            analytics_sigs = {
                "google-analytics": "Google Analytics",
                "gtag": "Google Tag Manager",
                "hotjar": "Hotjar",
                "mixpanel": "Mixpanel",
                "plausible": "Plausible",
            }
            for sig, name in analytics_sigs.items():
                if sig in body:
                    analytics.append(name)
                    technologies.append({"name": name, "category": "Analytics"})
    except Exception:
        pass

    if page:
        from app.services import tech_intel

        detected = await tech_intel.fingerprint(*page)
        if detected:
            technologies = await tech_intel.enrich(detected)
            summary = tech_intel.summarize(technologies)
            server = summary["server"] or server
            cms = summary["cms"]
            cdn = summary["cdn"]
            analytics = summary["analytics"]

    return TechStackResult(
        domain=domain, technologies=technologies,
        server=server, cms=cms, cdn=cdn, analytics=analytics,
    )


async def check_blacklists(domain: str) -> BlacklistResult:
    """Extended blacklist check via IPScope (32 DNSBL + AbuseIPDB + SpamRATS)."""
    from app.services.blacklist_extended import check_ip_blacklists

    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, domain, "A", lifetime=5)
        ip = str(answers[0])
    except Exception:
        return BlacklistResult(
            domain=domain, is_listed=False, blacklists_checked=0, listings=[], ip=None
        )

    try:
        result = await check_ip_blacklists(ip)
    except Exception:
        return await _check_blacklists_fallback(domain, ip)

    if result.get("private"):
        return BlacklistResult(
            domain=domain,
            is_listed=False,
            blacklists_checked=0,
            listings=[],
            ip=ip,
            source="private",
        )

    listings = [
        {
            "blacklist": item.get("name") or item.get("blacklist", ""),
            "listed": bool(item.get("listed")),
            "category": item.get("category"),
            "url": item.get("url"),
            "code": item.get("code"),
            "error": item.get("error", False),
            "skipped": item.get("skipped", False),
            "skip_reason": item.get("skip_reason", ""),
        }
        for item in result.get("dnsbl", [])
    ]
    listed_count = sum(1 for l in listings if l["listed"])
    return BlacklistResult(
        domain=domain,
        is_listed=listed_count > 0,
        blacklists_checked=result.get("total", len(listings)),
        listings=listings,
        ip=ip,
        abuseipdb=result.get("abuseipdb"),
        fortiguard=result.get("fortiguard"),
        source="extended",
    )


async def _check_blacklists_fallback(domain: str, ip: str) -> BlacklistResult:
    """Fallback to the original 4-list DNSBL check if extended fails."""
    from app.services.blacklist_extended import _is_valid_listing_code

    listings: list[dict] = []
    reversed_ip = ".".join(reversed(ip.split(".")))
    for bl in BLACKLISTS:
        query = f"{reversed_ip}.{bl}"
        try:
            answers = await asyncio.to_thread(dns.resolver.resolve, query, "A", lifetime=3)
            code = str(answers[0])
            listings.append({
                "blacklist": bl,
                "listed": _is_valid_listing_code(code),
                "code": code,
                "error": not _is_valid_listing_code(code),
            })
        except Exception:
            listings.append({"blacklist": bl, "listed": False})
    return BlacklistResult(
        domain=domain,
        is_listed=any(l["listed"] for l in listings),
        blacklists_checked=len(BLACKLISTS),
        listings=listings,
        ip=ip,
        source="fallback",
    )


async def fetch_host_intel(domain: str) -> dict | None:
    """IP geo/ASN/threat intel via ipdata.co when API key is configured."""
    from app.services.ip_lookup import lookup_ip
    from app.settings_store import SettingsStore

    if not SettingsStore.get_str("ipdata_api_key"):
        return None
    try:
        data = await lookup_ip(ip=domain)
        threat = data.get("threat") or {}
        asn = data.get("asn") or {}
        return {
            "ip": data.get("ip"),
            "country_name": data.get("country_name"),
            "country_code": data.get("country_code"),
            "region": data.get("region"),
            "city": data.get("city"),
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "emoji_flag": data.get("emoji_flag"),
            "asn": asn,
            "isp": asn.get("name"),
            "org": asn.get("name"),
            "threat": threat,
            "is_threat": bool(
                threat.get("is_threat")
                or threat.get("is_known_attacker")
                or threat.get("is_known_abuser")
            ),
            "threat_flags": {
                "tor": threat.get("is_tor"),
                "proxy": threat.get("is_proxy"),
                "vpn": threat.get("is_vpn"),
                "datacenter": threat.get("is_datacenter"),
                "attacker": threat.get("is_known_attacker"),
                "abuser": threat.get("is_known_abuser"),
                "anonymous": threat.get("is_anonymous"),
                "bogon": threat.get("is_bogon"),
            },
            "source": "ipdata.co",
        }
    except Exception:
        return None


async def fetch_rdap_enriched(domain: str) -> tuple[WHOISInfo | None, dict | None]:
    """Prefer RDAP (with DOMSCAN failover); fall back to python-whois."""
    from app.services.rdap_whois import lookup_rdap

    rdap_data = None
    try:
        rdap_data = await lookup_rdap(domain)
    except Exception:
        rdap_data = None

    whois_info = None
    if rdap_data:
        events = rdap_data.get("events") or {}
        entities = rdap_data.get("entities") or {}
        registrar_ent = entities.get("registrar") if isinstance(entities, dict) else None
        registrant_ent = (
            entities.get("registrant") or entities.get("registrant_contact")
            if isinstance(entities, dict) else None
        )

        def _parse_event(key: str) -> datetime | None:
            raw = events.get(key)
            return _parse_date(raw)

        statuses = rdap_data.get("status") or []
        status_list = [
            s.get("raw") if isinstance(s, dict) else str(s)
            for s in statuses
        ]
        whois_info = WHOISInfo(
            registrar=_registrar_from_rdap(rdap_data),
            creation_date=_parse_event("registration"),
            expiration_date=_parse_event("expiration"),
            updated_date=_parse_event("last changed") or _parse_event("last update of RDAP database"),
            name_servers=list(rdap_data.get("nameservers") or []),
            status=[s for s in status_list if s],
            registrant=_entity_text(registrant_ent, ("name", "org", "fn")) or _entity_text(registrar_ent, ("name", "org", "fn")),
        )
        return whois_info, rdap_data

    return None, None


def _dns_checker_to_records(domain: str, check: dict) -> list[DNSRecord]:
    records: list[DNSRecord] = []
    for rtype, items in (check.get("records") or {}).items():
        for item in items:
            if rtype == "SOA":
                value = " ".join(str(item.get(k, "")) for k in ("mname", "rname", "serial", "refresh", "retry", "expire", "minimum"))
            elif rtype == "SRV":
                value = f"{item.get('priority')} {item.get('weight')} {item.get('port')} {item.get('value')}"
            elif rtype == "CAA":
                value = f"{item.get('flags')} {item.get('tag')} {item.get('value')}"
            elif rtype == "MX":
                value = f"{item.get('priority')} {item.get('value')}"
            else:
                value = str(item.get("value", ""))
            if value.strip():
                records.append(DNSRecord(
                    type=rtype,
                    name=domain,
                    value=value.strip(),
                    ttl=item.get("ttl"),
                ))
    return records


async def fetch_dns_enriched(domain: str) -> tuple[list[DNSRecord], list[dict]]:
    """DNS via Cloudflare DoH with provider detection; fallback to local resolver."""
    from app.services.dns_checker import check_dns

    try:
        check = await check_dns(domain)
        records = _dns_checker_to_records(domain, check)
        providers = check.get("providers") or []
        if records:
            return records, providers
    except Exception:
        pass
    return await fetch_dns(domain), []


async def discover_subdomains(domain: str, include_certificates: bool = False) -> SubdomainResult:
    from app.services.subdomain_discovery import discover

    return await discover(domain, COMMON_SUBDOMAINS, include_certificates=include_certificates)


async def full_domain_scan(domain: str, monitor_method: str = "http", monitor_port: int | None = None) -> dict:
    """Full domain security scan with IPScope-enriched detection when API keys are set."""
    whois_task = fetch_rdap_enriched(domain)
    dns_task = fetch_dns_enriched(domain)
    ssl_task = fetch_ssl_or_none(domain)
    health_task = check_health(domain, monitor_method, monitor_port)
    email_task = analyze_email_security(domain)
    tech_task = detect_tech_stack(domain)
    blacklist_task = check_blacklists(domain)
    subdomain_task = discover_subdomains(domain)
    host_task = fetch_host_intel(domain)

    (
        (whois_data, rdap_data),
        (dns_data, providers),
        ssl_data,
        health,
        email,
        tech,
        blacklists,
        subdomains,
        host_intel,
    ) = await asyncio.gather(
        whois_task, dns_task, ssl_task, health_task,
        email_task, tech_task, blacklist_task, subdomain_task, host_task,
    )

    return {
        "domain": domain,
        "whois": whois_data,
        "rdap": rdap_data,
        "dns": dns_data,
        "providers": providers,
        "ssl": ssl_data,
        "email_security": email,
        "tech_stack": tech,
        "blacklists": blacklists,
        "subdomains": subdomains,
        "health": health,
        "host_intel": host_intel,
        "scanned_at": datetime.utcnow().isoformat(),
    }
