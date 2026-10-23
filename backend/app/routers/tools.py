from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from app.auth.deps import require_permissions
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import AlertRuleCreate
from app.services.domain_scanner import (
    analyze_email_security,
    check_blacklists,
    check_dns_propagation,
    check_health,
    detect_tech_stack,
    discover_subdomains,
    fetch_dns,
    fetch_ssl,
    fetch_whois,
    full_domain_scan,
)

router = APIRouter(dependencies=[Depends(require_permissions("tools:use"))])


@router.get("/scan/{domain}")
async def scan_domain_live(domain: str):
    return await full_domain_scan(domain)


@router.get("/whois/{domain}")
async def whois_lookup(domain: str):
    return await fetch_whois(domain)


@router.get("/dns/{domain}")
async def dns_lookup(domain: str):
    return await fetch_dns(domain)


@router.get("/ssl/{domain}")
async def ssl_check(domain: str):
    try:
        return await fetch_ssl(domain)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/health/{domain}")
async def health_check(domain: str):
    return await check_health(domain)


@router.get("/email-security/{domain}")
async def email_security(domain: str):
    return await analyze_email_security(domain)


@router.get("/propagation/{domain}")
async def dns_propagation(domain: str, record_type: str = "A"):
    return await check_dns_propagation(domain, record_type)


@router.get("/tech-stack/{domain}")
async def tech_stack(domain: str):
    return await detect_tech_stack(domain)


@router.get("/blacklists/{domain}")
async def blacklist_check(domain: str):
    return await check_blacklists(domain)


@router.get("/subdomains/{domain}")
async def subdomain_discovery(domain: str):
    try:
        return await discover_subdomains(domain, include_certificates=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/domain-suggestions")
async def domain_suggestions(keywords: List[str], tlds: Optional[List[str]] = None):
    tlds = tlds or [".com", ".io", ".dev", ".app", ".co"]
    suggestions = []
    prefixes = ["get", "my", "try", "use", "go", "the", "hey"]
    suffixes = ["hub", "app", "io", "ly", "ify", "box", "lab", "pro"]

    for kw in keywords:
        kw = kw.lower().strip()
        suggestions.append({"domain": f"{kw}.com", "type": "exact", "score": 95})
        for prefix in prefixes:
            suggestions.append({"domain": f"{prefix}{kw}.com", "type": "prefix", "score": 80})
        for suffix in suffixes:
            suggestions.append({"domain": f"{kw}{suffix}.com", "type": "suffix", "score": 75})
        for tld in tlds:
            if tld != ".com":
                suggestions.append({"domain": f"{kw}{tld}", "type": "tld_variant", "score": 70})

    return {"keywords": keywords, "suggestions": suggestions[:50]}
