import asyncio
import socket
import ssl
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID

from app.services import domain_scanner
from app.services.ssl_converter import convert_ssl


def _self_signed_cert(key, common_name="example.com", not_after_days=60):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    now = datetime.now(timezone.utc)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=not_after_days))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(common_name)]), critical=False)
        .sign(key, hashes.SHA256())
    )


def _pem(cert=None, key=None) -> str:
    parts = []
    if cert is not None:
        parts.append(cert.public_bytes(serialization.Encoding.PEM).decode())
    if key is not None:
        parts.append(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode())
    return "".join(parts)


def test_fetch_ssl_reports_self_signed_and_sans(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    cert = _self_signed_cert(key)
    der = cert.public_bytes(serialization.Encoding.DER)

    def fake_connect(domain, port, *, verify):
        if verify:
            raise ssl.SSLCertVerificationError("self-signed certificate")
        return der, "TLSv1.3", ("TLS_AES_256_GCM_SHA384", "TLSv1.3", 256)

    monkeypatch.setattr(domain_scanner, "_connect_tls", fake_connect)
    info = asyncio.run(domain_scanner.fetch_ssl("example.com"))

    assert info.is_self_signed is True
    assert info.trusted is False
    assert info.trust_error
    assert info.sans == ["example.com"]
    assert info.key_type == "EC"
    assert info.is_valid is True


def test_fetch_ssl_raises_readable_error_on_connection_failure(monkeypatch):
    def fake_connect(domain, port, *, verify):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(domain_scanner, "_connect_tls", fake_connect)
    with pytest.raises(ValueError, match="No se pudo resolver"):
        asyncio.run(domain_scanner.fetch_ssl("no-such-host.invalid"))


def test_fetch_ssl_or_none_swallows_connection_errors(monkeypatch):
    monkeypatch.setattr(domain_scanner, "fetch_ssl", AsyncMock(side_effect=ValueError("boom")))
    assert asyncio.run(domain_scanner.fetch_ssl_or_none("example.com")) is None


def test_ssl_service_stores_specific_connectivity_error(monkeypatch):
    from app.database import Base, async_session, engine
    from app.services import ssl_service
    from app.services.ssl_service import SSLService

    monkeypatch.setattr(ssl_service, "fetch_ssl", AsyncMock(side_effect=ValueError("Conexión rechazada en example.com:443")))

    async def run():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_session() as session:
                result = await SSLService(session).check_hostname("example.com")
        finally:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
        return result

    result = asyncio.run(run())
    assert result["status"] == "missing"
    assert result["last_error"] == "Conexión rechazada en example.com:443"
    assert result["is_valid"] is False


def test_converter_flags_self_signed_and_expiring_leaf():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = _self_signed_cert(key, not_after_days=10)
    result = convert_ssl(_pem(cert=cert), output_format="pem")
    assert result["certificates"][0]["is_self_signed"] is True
    assert "self_signed" in result["warnings"]
    assert "expiring_soon" in result["warnings"]


def test_converter_rejects_mismatched_key_for_bundle():
    cert_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = _self_signed_cert(cert_key)
    with pytest.raises(ValueError, match="no corresponde"):
        convert_ssl(_pem(cert=cert, key=other_key), output_format="pem_bundle")


def test_converter_reports_matching_key_without_error():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = _self_signed_cert(key)
    result = convert_ssl(_pem(cert=cert, key=key), output_format="pem_bundle")
    assert result["key_matches_certificate"] is True
    assert "key_mismatch" not in result["warnings"]
