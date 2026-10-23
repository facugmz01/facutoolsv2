"""Technology fingerprinting (Wappalyzer rules) enriched with endoflife.date and OSV.dev."""
from __future__ import annotations

import asyncio
import re
import time
import warnings
from typing import Any

import httpx

EXTERNAL_TIMEOUT = 5.0
CACHE_TTL_SECONDS = 24 * 3600

# Wappalyzer technology name -> endoflife.date product
EOL_PRODUCTS = {
    "nginx": "nginx",
    "apache http server": "apache-http-server",
    "php": "php",
    "wordpress": "wordpress",
    "drupal": "drupal",
    "node.js": "nodejs",
    "python": "python",
    "ruby": "ruby",
    "laravel": "laravel",
    "django": "django",
    "symfony": "symfony",
    "microsoft asp.net": "dotnet",
    "iis": "iis",
    "openssl": "openssl",
    "mysql": "mysql",
    "postgresql": "postgresql",
    "angular": "angular",
    "bootstrap": "bootstrap",
}

# Wappalyzer technology name -> npm package name for OSV.dev
OSV_NPM_PACKAGES = {
    "jquery": "jquery",
    "jquery ui": "jquery-ui",
    "bootstrap": "bootstrap",
    "angularjs": "angular",
    "vue.js": "vue",
    "react": "react",
    "lodash": "lodash",
    "moment.js": "moment",
    "handlebars": "handlebars",
    "underscore.js": "underscore",
}

_cache: dict[str, tuple[float, Any]] = {}
_wappalyzer = None


def _cache_get(key: str) -> Any | None:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]
    return None


def _cache_put(key: str, value: Any) -> Any:
    _cache[key] = (time.monotonic(), value)
    return value


def _load_wappalyzer():
    global _wappalyzer
    if _wappalyzer is None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from Wappalyzer import Wappalyzer

            _wappalyzer = Wappalyzer.latest()
    return _wappalyzer


def _fingerprint_sync(url: str, html: str, headers: dict[str, str]) -> list[dict]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from Wappalyzer import WebPage

        wappalyzer = _load_wappalyzer()
        page = WebPage(url, html, {k.lower(): v for k, v in headers.items()})
        found = wappalyzer.analyze_with_versions_and_categories(page)
    techs: list[dict] = []
    for name, info in found.items():
        versions = [v for v in info.get("versions", []) if v]
        categories = info.get("categories", [])
        techs.append({
            "name": name,
            "category": categories[0] if categories else None,
            "categories": categories,
            "version": versions[0] if versions else None,
            "source": "wappalyzer",
        })
    return techs


async def fingerprint(url: str, html: str, headers: dict[str, str]) -> list[dict]:
    try:
        return await asyncio.to_thread(_fingerprint_sync, url, html, headers)
    except Exception:
        return []


async def _eol_cycles(client: httpx.AsyncClient, product: str) -> list[dict] | None:
    key = f"eol:{product}"
    cached = _cache_get(key)
    if cached is not None:
        return cached or None
    try:
        response = await client.get(f"https://endoflife.date/api/{product}.json")
        if response.status_code != 200:
            return _cache_put(key, []) or None
        return _cache_put(key, response.json())
    except Exception:
        return None


def _is_eol(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value <= time.strftime("%Y-%m-%d")
    return False


def _match_cycle(version: str, cycles: list[dict]) -> dict | None:
    # Longest matching cycle prefix wins ("1.18" over "1").
    best = None
    for cycle in cycles:
        label = str(cycle.get("cycle", ""))
        if version == label or version.startswith(label + "."):
            if best is None or len(label) > len(str(best.get("cycle", ""))):
                best = cycle
    return best


async def _enrich_eol(client: httpx.AsyncClient, tech: dict) -> None:
    product = EOL_PRODUCTS.get(tech["name"].lower())
    version = tech.get("version")
    if not product or not version:
        return
    cycles = await _eol_cycles(client, product)
    if not cycles:
        return
    cycle = _match_cycle(version, cycles)
    if cycle:
        tech["eol"] = _is_eol(cycle.get("eol"))
        tech["eol_date"] = cycle.get("eol") if isinstance(cycle.get("eol"), str) else None
        tech["outdated"] = cycle is not cycles[0]
    tech["latest_version"] = cycles[0].get("latest")


async def _enrich_osv(client: httpx.AsyncClient, tech: dict) -> None:
    package = OSV_NPM_PACKAGES.get(tech["name"].lower())
    version = tech.get("version")
    if not package or not version or not re.match(r"^\d+(\.\d+)*", version):
        return
    key = f"osv:{package}:{version}"
    vulns = _cache_get(key)
    if vulns is None:
        try:
            response = await client.post(
                "https://api.osv.dev/v1/query",
                json={"package": {"name": package, "ecosystem": "npm"}, "version": version},
            )
            if response.status_code != 200:
                return
            vulns = _cache_put(key, [v.get("id") for v in response.json().get("vulns", [])])
        except Exception:
            return
    tech["vulnerabilities"] = len(vulns)
    tech["vulnerability_ids"] = vulns[:5]


async def enrich(technologies: list[dict]) -> list[dict]:
    """Add EOL and known-vulnerability data. Failures leave the technology untouched."""
    async with httpx.AsyncClient(timeout=EXTERNAL_TIMEOUT) as client:
        await asyncio.gather(
            *[_enrich_eol(client, t) for t in technologies],
            *[_enrich_osv(client, t) for t in technologies],
            return_exceptions=True,
        )
    return technologies


def summarize(technologies: list[dict]) -> dict:
    """Derive the legacy server/cms/cdn/analytics fields from categorized technologies."""

    def first(*categories: str) -> str | None:
        for tech in technologies:
            if any(c in categories for c in tech.get("categories", [])):
                return f"{tech['name']} {tech['version']}" if tech.get("version") and categories[0] == "Web servers" else tech["name"]
        return None

    analytics = [
        t["name"] for t in technologies
        if any(c in ("Analytics", "Tag managers") for c in t.get("categories", []))
    ]
    return {
        "server": first("Web servers"),
        "cms": first("CMS", "Ecommerce", "Blogs"),
        "cdn": first("CDN"),
        "analytics": analytics,
    }
