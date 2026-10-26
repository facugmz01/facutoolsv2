from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import asyncio

import pytest

from app.services.domain_service import DomainService


def _svc():
    return DomainService(db=None, organization_id=1)


def _scan(**over):
    base = {
        "ssl": SimpleNamespace(is_valid=True, days_remaining=40),
        "health": {"is_up": True, "response_time_ms": 120},
        "email_security": SimpleNamespace(score=80),
        "subdomains": SimpleNamespace(total_found=3),
        "blacklists": SimpleNamespace(is_listed=False),
        "tech_stack": SimpleNamespace(technologies=[1, 2]),
    }
    base.update(over)
    return base


def test_compare_normalizes_dedupes_and_maps_metrics():
    with patch("app.services.domain_service.full_domain_scan", AsyncMock(return_value=_scan())):
        res = asyncio.run(_svc().compare_domains(["Example.com", "example.com.", "other.org"]))
    assert res["domains"] == ["example.com", "other.org"]
    assert res["comparison"]["other.org"] == {
        "ssl_valid": True, "ssl_days": 40, "is_up": True, "response_time": 120,
        "email_score": 80, "subdomains": 3, "blacklisted": False, "technologies": 2,
    }


def test_compare_isolates_failures():
    async def fake(name):
        if name == "bad.com":
            raise RuntimeError("boom")
        return _scan()

    with patch("app.services.domain_service.full_domain_scan", side_effect=fake):
        res = asyncio.run(_svc().compare_domains(["ok.com", "bad.com"]))
    assert res["comparison"]["bad.com"] == {"error": "boom"}
    assert res["comparison"]["ok.com"]["ssl_valid"] is True


@pytest.mark.parametrize("names", [["a.com"], ["a.com", "A.com"], ["a.com", "http://b.com"], [f"d{i}.com" for i in range(6)]])
def test_compare_rejects_invalid_input(names):
    with pytest.raises(ValueError):
        asyncio.run(_svc().compare_domains(names))
