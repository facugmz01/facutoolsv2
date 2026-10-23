from __future__ import annotations

import re

DOMAIN_RE = re.compile(r"^([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}$")
IPV4_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


def normalize_domain(raw: str) -> str:
    domain = raw.strip().lower()
    domain = re.sub(r"^https?://", "", domain)
    domain = domain.split("/")[0].split("?")[0].rstrip(".")
    return domain


def is_valid_domain(domain: str) -> bool:
    return bool(DOMAIN_RE.match(domain))


def is_valid_ipv4(ip: str) -> bool:
    if not IPV4_RE.match(ip):
        return False
    return all(0 <= int(o) <= 255 for o in ip.split("."))
