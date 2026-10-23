import re
from typing import Optional, Tuple

DOMAIN_PATTERN = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
    re.IGNORECASE,
)

SUBDOMAIN_LABEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

NOTIFICATION_TYPES = [
    "expiring_soon",
    "ip_change",
    "registrar",
    "whois_change",
    "dns_change",
    "ssl_expiry",
    "ssl_change",
    "host_change",
    "security_change",
]

DEFAULT_NOTIFICATIONS = {
    "expiring_soon": True,
    "ip_change": False,
    "registrar": False,
    "whois_change": False,
    "dns_change": False,
    "ssl_expiry": False,
    "ssl_change": False,
    "host_change": False,
    "security_change": False,
}


def normalize_domain(name: str) -> str:
    return name.strip().lower().rstrip(".")


def validate_domain(name: str) -> Tuple[bool, Optional[str], str]:
    normalized = normalize_domain(name)
    if not normalized:
        return False, "El nombre de dominio es requerido", normalized
    if len(normalized) > 253:
        return False, "El dominio es demasiado largo", normalized
    if "://" in name or "/" in name or " " in name:
        return False, "Ingresá solo el dominio (ej: ejemplo.com)", normalized
    if not DOMAIN_PATTERN.match(normalized):
        return False, "Formato de dominio inválido", normalized
    return True, None, normalized


def normalize_subdomain(hostname: str, domain: str) -> str:
    host = hostname.strip().lower().rstrip(".")
    if not host or "://" in host or "/" in host or " " in host:
        return ""
    if host == domain:
        return ""
    if host.startswith(".") or host.endswith(".") or ".." in host:
        return ""
    if not host.endswith(f".{domain}"):
        host = f"{host}.{domain}"
    if not host.endswith(f".{domain}"):
        return ""
    base = host[: -len(f".{domain}")]
    if not base:
        return ""
    labels = base.split(".")
    if any(not label or len(label) > 63 or not SUBDOMAIN_LABEL_PATTERN.match(label) for label in labels):
        return ""
    return host


def parse_subdomain_input(input: str, domain: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for raw in re.split(r"[\n,]+", input):
        candidate = normalize_subdomain(raw.strip(), domain)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        values.append(candidate)
    return values
