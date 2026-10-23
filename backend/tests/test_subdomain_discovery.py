import asyncio
from unittest.mock import AsyncMock

import dns.resolver
import httpx
import pytest

from app.services import subdomain_discovery as discovery


def record(hostname, ips=None, cname=None):
    return {
        "subdomain": hostname, "ips": ips or [], "ipv4": ips or [], "ipv6": [],
        "cname": cname, "active": bool(ips), "status": "resolved" if ips else "no_address",
        "dns_partial": False, "wildcard": False,
    }


def test_certificate_candidates_are_deduplicated_and_unresolved_names_retained(monkeypatch):
    monkeypatch.setattr(discovery, "_certificate_names", AsyncMock(return_value=({"api.example.com", "old.example.com"}, False)))

    async def resolve(resolver, hostname):
        return record(hostname, ["8.8.8.8"] if hostname == "api.example.com" else [])

    monkeypatch.setattr(discovery, "_resolve_candidate", resolve)
    result = asyncio.run(discovery.discover("EXAMPLE.COM", ["api"], True))
    assert result.total_checked == result.total_found == 2
    assert result.resolved_count == 1
    assert result.subdomains[0]["sources"] == ["common", "certificate"]
    assert result.subdomains[1]["status"] == "no_address"


def test_wildcard_guesses_are_filtered_but_certificate_names_are_flagged(monkeypatch):
    monkeypatch.setattr(discovery, "_certificate_names", AsyncMock(return_value=({"api.example.com"}, False)))

    async def resolve(resolver, hostname):
        return record(hostname, ["8.8.8.8"])

    monkeypatch.setattr(discovery, "_resolve_candidate", resolve)
    result = asyncio.run(discovery.discover("example.com", ["api", "www"], True))
    assert result.wildcard_detected
    assert result.wildcard_filtered == 1
    assert result.total_found == 1
    assert result.subdomains[0]["wildcard"]


def test_certificate_failure_returns_dns_results_and_warning(monkeypatch):
    monkeypatch.setattr(discovery, "_certificate_names", AsyncMock(side_effect=httpx.ReadTimeout("timeout")))

    async def resolve(resolver, hostname):
        return record(hostname, ["8.8.8.8"] if hostname == "www.example.com" else [])

    monkeypatch.setattr(discovery, "_resolve_candidate", resolve)
    result = asyncio.run(discovery.discover("example.com", ["www"], True))
    assert result.total_found == 1
    assert result.warnings == ["certificate_source_unavailable"]


def test_dns_related_records_add_in_domain_names_and_ignore_external_targets():
    class Record:
        def __init__(self, value, exchange=None, target=None):
            self.value = value
            self.exchange = exchange
            self.target = target

        def __str__(self):
            return self.value

    async def resolve(hostname, record_type, **kwargs):
        if record_type == "NS":
            return [Record("ns1.example.com.")]
        if record_type == "MX":
            return [Record("10 mail.example.com.", exchange="mail.example.com."), Record("10 aspmx.google.com.", exchange="aspmx.google.com.")]
        if record_type == "SRV":
            return [Record("0 5 443 service.example.com.", target="service.example.com.")]
        if record_type == "CNAME":
            return [Record("target.example.com.")]
        if record_type == "TXT":
            return [Record('"verify=api.example.com"')]
        raise dns.resolver.NoAnswer()

    resolver = AsyncMock()
    resolver.resolve.side_effect = resolve
    names, failed = asyncio.run(discovery._dns_related_names(resolver, "example.com"))
    assert not failed
    assert names == {"ns1.example.com", "mail.example.com", "service.example.com", "target.example.com", "api.example.com"}


def test_dns_source_failure_returns_warning_without_breaking_discovery(monkeypatch):
    monkeypatch.setattr(discovery, "_dns_related_names", AsyncMock(return_value=(set(), True)))

    async def resolve(resolver, hostname):
        return record(hostname, ["8.8.8.8"] if hostname == "www.example.com" else [])

    monkeypatch.setattr(discovery, "_resolve_candidate", resolve)
    result = asyncio.run(discovery.discover("example.com", ["www"]))
    assert result.total_found == 1
    assert "dns_source_unavailable" in result.warnings


def test_private_discovery_does_not_query_certificates_or_return_unresolved(monkeypatch):
    certificates = AsyncMock()
    monkeypatch.setattr(discovery, "_certificate_names", certificates)
    monkeypatch.setattr(discovery, "_resolve_candidate", AsyncMock(side_effect=lambda resolver, hostname: record(hostname)))
    result = asyncio.run(discovery.discover("example.com", ["www"]))
    assert result.total_found == 0
    certificates.assert_not_called()


def test_ipv6_only_and_cname_are_resolved():
    class Answer(list):
        canonical_name = "edge.example.com."

    async def resolve(hostname, record_type, **kwargs):
        if record_type == "A":
            raise dns.resolver.NoAnswer()
        return Answer(["2606:4700:4700::1111"])

    resolver = AsyncMock()
    resolver.resolve.side_effect = resolve
    result = asyncio.run(discovery._resolve_candidate(resolver, "www.example.com"))
    assert result["active"]
    assert result["ipv4"] == []
    assert result["ipv6"] == ["2606:4700:4700::1111"]
    assert result["cname"] == "edge.example.com"


def test_invalid_domain_rejected():
    with pytest.raises(ValueError):
        asyncio.run(discovery.discover("not a domain", ["www"], True))