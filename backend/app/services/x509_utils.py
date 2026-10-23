"""Shared helpers for inspecting parsed x509 certificates."""

from __future__ import annotations

from typing import Any, Optional

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import ExtensionOID


def subject_alt_names(cert: x509.Certificate) -> list[str]:
    try:
        ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
    except x509.ExtensionNotFound:
        return []
    names: list[str] = []
    for entry in ext.value:
        if isinstance(entry, x509.DNSName):
            names.append(entry.value)
        elif isinstance(entry, x509.IPAddress):
            names.append(str(entry.value))
        elif isinstance(entry, (x509.RFC822Name, x509.UniformResourceIdentifier)):
            names.append(entry.value)
        else:
            names.append(entry.value if hasattr(entry, "value") else str(entry))
    return names


def is_self_signed(cert: x509.Certificate) -> bool:
    return cert.issuer == cert.subject


def public_key_info(cert_or_key: Any) -> tuple[Optional[str], Optional[int]]:
    """Return (key_type, key_size_bits) for a certificate or a private/public key."""
    public_key = cert_or_key.public_key() if hasattr(cert_or_key, "public_key") else cert_or_key
    key_type = type(public_key).__name__.replace("PublicKey", "").replace("PrivateKey", "")
    try:
        return key_type, public_key.key_size
    except AttributeError:
        pass
    try:
        return key_type, public_key.curve.key_size
    except AttributeError:
        return key_type, None


def keys_match(private_key: Any, cert: x509.Certificate) -> bool:
    """Compare a private key's public part against a certificate's public key."""
    encode = lambda key: key.public_bytes(  # noqa: E731
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    try:
        return encode(private_key.public_key()) == encode(cert.public_key())
    except Exception:
        return False
