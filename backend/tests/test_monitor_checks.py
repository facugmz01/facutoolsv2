import asyncio
import datetime as dt
from types import SimpleNamespace

from app.services import verification_checks


def assert_standard_result(result):
    assert set(result) == {"status", "latency_ms", "details", "error_message"}
    assert result["status"] in {"UP", "DOWN", "WARNING"}
    assert isinstance(result["latency_ms"], float)
    assert isinstance(result["details"], dict)
    assert result["error_message"] is None or isinstance(result["error_message"], str)


def test_check_tcp_port_returns_standard_result():
    async def run():
        async def handle(reader, writer):
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            result = await verification_checks.check_tcp_port("127.0.0.1", port)
        finally:
            server.close()
            await server.wait_closed()
        return result

    result = asyncio.run(run())
    assert_standard_result(result)
    assert result["status"] == "UP"
    assert result["details"]["port"] > 0


def test_check_ping_returns_standard_result(monkeypatch):
    class FakeProcess:
        returncode = 0

        async def communicate(self):
            return b"64 bytes from example.test: time=12.34 ms", b""

        async def wait(self):
            return None

    async def fake_create_process(*args, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(verification_checks.asyncio, "create_subprocess_exec", fake_create_process)
    result = asyncio.run(verification_checks.check_ping("example.test"))

    assert_standard_result(result)
    assert result["status"] == "UP"
    assert result["details"]["ping_time_ms"] == 12.34


def test_check_http_keyword(monkeypatch):
    class FakeResponse:
        status_code = 200
        text = '{"status":"ready"}'
        headers = {"content-type": "application/json"}
        url = "https://example.test/health"

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(verification_checks.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    result = asyncio.run(verification_checks.check_http_keyword(FakeResponse.url, "ready"))

    assert_standard_result(result)
    assert result["status"] == "UP"
    assert result["details"]["matched"] is True


def test_check_wordpress_detects_rest_api(monkeypatch):
    class FakeResponse:
        status_code = 200
        headers = {"content-type": "application/json"}
        url = "https://example.test/wp-json"

        def json(self):
            return {"name": "Example WordPress", "routes": {"/wp/v2/posts": {}}}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers):
            assert url == "https://example.test/wp-json"
            return FakeResponse()

    monkeypatch.setattr(verification_checks.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    result = asyncio.run(verification_checks.check_wordpress("https://example.test"))

    assert_standard_result(result)
    assert result["status"] == "UP"
    assert result["details"]["wordpress_detected"] is True
    assert result["details"]["site_name"] == "Example WordPress"


def test_check_soap_detects_fault(monkeypatch):
    class FakeResponse:
        status_code = 500
        text = '<soap:Fault><faultstring>Invalid token</faultstring></soap:Fault>'
        headers = {"content-type": "text/xml"}
        url = "https://example.test/service.asmx"

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, content, headers):
            assert headers["SOAPAction"] == "urn:Test"
            assert content == b"<soap:Envelope />"
            return FakeResponse()

    monkeypatch.setattr(verification_checks.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    result = asyncio.run(
        verification_checks.check_soap(
            FakeResponse.url,
            "urn:Test",
            "<soap:Envelope />",
        )
    )

    assert_standard_result(result)
    assert result["status"] == "DOWN"
    assert result["details"]["fault"] is True


def test_check_soap_detects_afip_component_failure(monkeypatch):
    class FakeResponse:
        status_code = 200
        text = """<Envelope><Body><FEDummyResult>
        <AppServer>OK</AppServer><DbServer>MANTENIMIENTO</DbServer><AuthServer>OK</AuthServer>
        </FEDummyResult></Body></Envelope>"""
        headers = {"content-type": "text/xml"}
        url = "https://example.test/service.asmx"

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, content, headers):
            return FakeResponse()

    monkeypatch.setattr(verification_checks.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    result = asyncio.run(verification_checks.check_soap(FakeResponse.url, "urn:Test", "<Envelope />"))

    assert result["status"] == "DOWN"
    assert result["details"]["components_ok"] is False
    assert result["details"]["service_status"]["DbServer"] == "MANTENIMIENTO"


def test_check_ssl_warning(monkeypatch):
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=10)

    class FakeWriter:
        def get_extra_info(self, name):
            return {"notAfter": expires.strftime("%b %d %H:%M:%S %Y GMT")}

        def close(self):
            return None

        async def wait_closed(self):
            return None

    async def fake_open_connection(*args, **kwargs):
        return None, FakeWriter()

    monkeypatch.setattr(verification_checks.asyncio, "open_connection", fake_open_connection)
    result = asyncio.run(verification_checks.check_ssl("example.test"))

    assert_standard_result(result)
    assert result["status"] == "WARNING"
    assert result["details"]["severity"] == "WARNING"
    assert 9 < result["details"]["days_remaining"] < 11


def test_check_whois_expiration_critical(monkeypatch):
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=5)
    monkeypatch.setattr(
        verification_checks.whois,
        "whois",
        lambda domain: SimpleNamespace(expiration_date=expires),
    )

    result = asyncio.run(verification_checks.check_whois_expiration("example.test"))

    assert_standard_result(result)
    assert result["status"] == "DOWN"
    assert result["details"]["severity"] == "CRITICAL"
    assert 4 < result["details"]["days_remaining"] < 6
