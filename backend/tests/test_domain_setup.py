import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from app.database import Base, async_session, engine
from app.models import Domain, HealthCheck, Organization, Subdomain
from app.schemas import DomainNotificationSettings, DomainSetupRequest, SSLInfo
from app.services import domain_service
from app.services.domain_scanner import _parse_date, check_health, fetch_rdap_enriched
from app.services.domain_service import DomainService, DomainSetupError
from app.utils.domain_validation import parse_subdomain_input


@pytest.fixture(autouse=True)
def http_health_check(monkeypatch):
    probe = AsyncMock(return_value={
        "is_up": True,
        "status_code": 200,
        "response_time_ms": 42.0,
        "final_url": "https://portal.example.com",
    })
    monkeypatch.setattr(domain_service, "check_health", probe)
    return probe


@pytest.fixture
def db_session():
    async def _setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_session() as session:
            yield session
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    async def _run():
        async with async_session() as session:
            await _setup_impl(session)

    return _setup


def _run_async(coro):
    return asyncio.run(coro)


async def _setup_impl(session):
    org = Organization(name="Acme", slug="acme")
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return org


def test_setup_domain_raises_domain_setup_error_on_duplicate():
    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                org = Organization(name="Acme", slug="acme")
                session.add(org)
                await session.commit()
                await session.refresh(org)

                session.add(Domain(organization_id=org.id, name="example.com"))
                await session.commit()

                service = DomainService(session, organization_id=org.id)
                with pytest.raises(DomainSetupError, match="portfolio|already"):
                    await service.setup_domain(
                        DomainSetupRequest(
                            name="example.com",
                            subdomains=[],
                            notifications=DomainNotificationSettings(),
                        )
                    )
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())


@pytest.mark.parametrize("is_up,status_code", [(True, 200), (False, 503), (False, None)])
def test_setup_domain_persists_domain_and_subdomains(http_health_check, is_up, status_code):
    http_health_check.return_value.update(is_up=is_up, status_code=status_code)

    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                org = Organization(name="Demo", slug="demo")
                session.add(org)
                await session.commit()
                await session.refresh(org)

                service = DomainService(session, organization_id=org.id)
                result = await service.setup_domain(
                    DomainSetupRequest(
                        name="portal.example.com",
                        registrar="Example Registrar",
                        notes="Initial setup",
                        tags=["prod", "main"],
                        subdomains=["www", "api", "www"],
                        notifications=DomainNotificationSettings(
                            preferences={"domain_down": True},
                            include_subdomains=True,
                        ),
                    )
                )

                stored_domain = await session.execute(select(Domain).where(Domain.name == "portal.example.com"))
                domain = stored_domain.scalar_one()
                assert domain.registrar == "Example Registrar"
                assert domain.notes == "Initial setup"

                stored_subdomains = await session.execute(select(Subdomain).where(Subdomain.domain_id == domain.id))
                subdomains = stored_subdomains.scalars().all()
                assert {sub.hostname for sub in subdomains} == {"www.portal.example.com", "api.portal.example.com"}
                assert result["domain"]["name"] == "portal.example.com"
                http_health_check.assert_awaited_once_with("portal.example.com")
                assert result["domain"]["latest_health"]["is_up"] is is_up
                assert result["domain"]["latest_health"]["status_code"] == status_code
                persisted = await service.get_domain(domain.id)
                assert persisted["latest_health"] == result["domain"]["latest_health"]
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())


def test_setup_domain_accepts_timezone_aware_expiry_dates():
    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                org = Organization(name="Demo", slug="demo")
                session.add(org)
                await session.commit()
                await session.refresh(org)

                service = DomainService(session, organization_id=org.id)
                result = await service.setup_domain(
                    DomainSetupRequest(
                        name="aware.example.com",
                        registrar="Example Registrar",
                        expires_at=datetime(2027, 7, 27, 0, 0, tzinfo=timezone.utc),
                        subdomains=[],
                        notifications=DomainNotificationSettings(),
                    )
                )

                stored_domain = await session.execute(select(Domain).where(Domain.name == "aware.example.com"))
                domain = stored_domain.scalar_one()
                assert domain.expires_at == datetime(2027, 7, 27, 0, 0)
                assert result["domain"]["name"] == "aware.example.com"
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())


def test_manual_scan_returns_and_persists_health(monkeypatch):
    health = {"is_up": True, "status_code": 200, "response_time_ms": 25.0}
    scan = AsyncMock(return_value={
        "health": health,
        "ssl": SSLInfo(
            issuer="CN=Example CA",
            subject="CN=example.com",
            valid_from=datetime(2026, 8, 21, 11, 17, 6, tzinfo=timezone.utc),
            is_valid=True,
            valid_until=datetime(2026, 11, 21, 11, 17, 6, tzinfo=timezone.utc),
            days_remaining=59,
        ),
    })
    monkeypatch.setattr(domain_service, "full_domain_scan", scan)

    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                org = await _setup_impl(session)
                domain = Domain(organization_id=org.id, name="example.com")
                session.add(domain)
                await session.commit()
                service = DomainService(session, organization_id=org.id)
                result = await service.scan_and_update(domain.id)
                assert result["health"] == health
                scan.assert_awaited_once_with("example.com", monitor_method="http", monitor_port=None)
                persisted = await service.get_domain(domain.id)
                assert persisted["latest_health"]["status_code"] == 200
                assert persisted["latest_health"]["response_time_ms"] == 25.0
                assert persisted["latest_health"]["is_up"] is True
                stored_health = await session.execute(select(HealthCheck).where(HealthCheck.domain_id == domain.id))
                health_check = stored_health.scalar_one()
                assert health_check.ssl_valid is True
                assert health_check.ssl_expires_at == datetime(2026, 11, 21, 11, 17, 6)
                assert health_check.ssl_expires_at.tzinfo is None
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())


@pytest.mark.parametrize("status_code", [200, 404, 503])
def test_health_uses_http_get(monkeypatch, status_code):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(status_code)

    client_class = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client_class(
        transport=httpx.MockTransport(respond), **kwargs,
    ))
    result = _run_async(check_health("example.com"))
    assert [(request.method, str(request.url)) for request in requests] == [("GET", "https://example.com")]
    assert result["status_code"] == status_code
    assert result["is_up"] is (status_code < 500)
    assert result["response_time_ms"] >= 0


@pytest.mark.parametrize("http_available", [True, False])
def test_health_falls_back_to_http(monkeypatch, http_available):
    requests = []

    def respond(request):
        requests.append(str(request.url))
        if request.url.scheme == "https" or not http_available:
            raise httpx.ConnectError("Connection failed", request=request)
        return httpx.Response(200)

    client_class = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client_class(
        transport=httpx.MockTransport(respond), **kwargs,
    ))
    result = _run_async(check_health("example.com"))
    assert requests == ["https://example.com", "http://example.com"]
    assert result["is_up"] is http_available
    assert result["status_code"] == (200 if http_available else None)


def test_parse_date_accepts_rdap_iso_expiration_strings():
    assert _parse_date("2027-04-11T00:06:05.747Z") == datetime(2027, 4, 11, 0, 6, 5, 747000)
    assert _parse_date([None, "2030-01-01"]) == datetime(2030, 1, 1)


def test_rdap_enriched_maps_iso_expiration_event(monkeypatch):
    async def fake_lookup_rdap(domain: str):
        return {
            "events": {"expiration": "2027-04-11T00:06:05.747Z"},
            "entities": {"registrar": {"name": "Example Registrar"}},
            "nameservers": [],
            "status": [],
        }

    monkeypatch.setattr("app.services.rdap_whois.lookup_rdap", fake_lookup_rdap)

    whois_info, rdap_data = _run_async(fetch_rdap_enriched("example.com"))

    assert rdap_data is not None
    assert whois_info.expiration_date == datetime(2027, 4, 11, 0, 6, 5, 747000)


def test_rdap_enriched_uses_nic_ar_registrar_handle(monkeypatch):
    async def fake_lookup_rdap(domain: str):
        return {
            "source": "NIC Argentina (RDAP)",
            "events": {"expiration": "2027-07-27 09:00:00 UTC"},
            "entities": {"registrar": {"handle": "nicar"}},
            "nameservers": [],
            "status": [],
        }

    monkeypatch.setattr("app.services.rdap_whois.lookup_rdap", fake_lookup_rdap)

    whois_info, rdap_data = _run_async(fetch_rdap_enriched("sandramarzzan.com.ar"))

    assert rdap_data is not None
    assert whois_info.registrar == "NIC Argentina"


@pytest.mark.parametrize("registrar_payload, expected", [
    ({"name": "Example Registrar LLC", "handle": "example-handle"}, "Example Registrar LLC"),
    ({"org": "Example Org Registrar", "handle": "example-handle"}, "Example Org Registrar"),
    ({"handle": "example-handle"}, "example-handle"),
    ({"iana_id": "292"}, "292"),
    ("Plain Registrar", "Plain Registrar"),
])
def test_rdap_enriched_uses_generic_registrar_fallbacks(monkeypatch, registrar_payload, expected):
    async def fake_lookup_rdap(domain: str):
        return {
            "events": {},
            "entities": {"registrar": registrar_payload},
            "nameservers": [],
            "status": [],
        }

    monkeypatch.setattr("app.services.rdap_whois.lookup_rdap", fake_lookup_rdap)

    whois_info, rdap_data = _run_async(fetch_rdap_enriched("example.com"))

    assert rdap_data is not None
    assert whois_info.registrar == expected


def test_parse_subdomain_input_filters_invalid_values():
    values = parse_subdomain_input("www, api.example.com, bad://host, , foo..bar, www", "example.com")
    assert values == ["www.example.com", "api.example.com"]


def test_preview_domain_uses_cache(monkeypatch):
    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                service = DomainService(session)
                calls = {"count": 0}

                async def fake_scan(name: str):
                    calls["count"] += 1
                    return {"whois": {"registrar": "Acme", "expiration_date": "2030-01-01"}}

                monkeypatch.setattr("app.services.domain_service.full_domain_scan", fake_scan)
                first = await service.preview_domain("example.com")
                second = await service.preview_domain("example.com")

                assert first["domain"] == "example.com"
                assert second["domain"] == "example.com"
                assert calls["count"] == 1
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())


def test_preview_cache_is_invalidated_after_setup(monkeypatch):
    async def _inner():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                org = Organization(name="Acme", slug="acme")
                session.add(org)
                await session.commit()
                await session.refresh(org)

                service = DomainService(session, organization_id=org.id)
                calls = {"count": 0}
                domain_service._PREVIEW_CACHE.clear()

                async def fake_scan(name: str):
                    calls["count"] += 1
                    return {"whois": {"registrar": "Acme", "expiration_date": "2030-01-01"}}

                monkeypatch.setattr("app.services.domain_service.full_domain_scan", fake_scan)
                await service.preview_domain("example.com")
                await service.setup_domain(
                    DomainSetupRequest(
                        name="example.com",
                        registrar="Acme",
                        subdomains=[],
                        notifications=DomainNotificationSettings(),
                    )
                )
                await service.preview_domain("example.com")

                assert calls["count"] == 2
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)

    _run_async(_inner())
