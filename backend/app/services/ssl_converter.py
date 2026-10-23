"""Convert SSL/TLS certificates and keys between common formats."""

from __future__ import annotations

import base64
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7, pkcs12
from cryptography.x509.oid import NameOID

from app.services.x509_utils import is_self_signed, keys_match, public_key_info, subject_alt_names

SUPPORTED_INPUT = ("auto", "pem", "der", "pkcs12", "pkcs7", "pfx", "p12", "p7b")
SUPPORTED_OUTPUT = (
    "pem",
    "pem_full",
    "pem_bundle",
    "pem_key",
    "pem_key_rsa",
    "der",
    "der_key",
    "pkcs12",
    "pfx",
    "p12",
    "pkcs7",
    "p7b",
)


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _decode_input(raw: str) -> bytes:
    """Decode pasted text or base64/hex into bytes."""
    text = raw.strip().replace("\r\n", "\n").replace("\r", "\n")
    if not text:
        raise ValueError("No se recibió ningún certificado o clave")

    if "-----BEGIN" in text:
        return text.encode("utf-8")

    compact = re.sub(r"\s+", "", text)
    # Hex dump (DER often pasted as hex)
    if re.fullmatch(r"[0-9a-fA-F]+", compact) and len(compact) % 2 == 0 and len(compact) >= 8:
        try:
            return bytes.fromhex(compact)
        except ValueError:
            pass

    # Base64 (with or without PEM headers stripped)
    try:
        padded = compact + "=" * (-len(compact) % 4)
        return base64.b64decode(padded, validate=False)
    except Exception as exc:
        raise ValueError("No se pudo decodificar el contenido (PEM, Base64 o Hex)") from exc


def _name_to_str(name: x509.Name) -> str:
    parts = []
    for attr in name:
        key = attr.oid._name if attr.oid._name != "Unknown OID" else attr.oid.dotted_string
        parts.append(f"{key}={attr.value}")
    return ", ".join(parts)


def _cert_info(cert: x509.Certificate) -> Dict[str, Any]:
    cn = None
    try:
        cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    except (IndexError, ValueError):
        pass

    now = datetime.now(timezone.utc)
    not_after = cert.not_valid_after_utc
    days_left = (not_after - now).days
    key_type, key_bits = public_key_info(cert)

    return {
        "subject": _name_to_str(cert.subject),
        "issuer": _name_to_str(cert.issuer),
        "common_name": cn,
        "serial_number": format(cert.serial_number, "x"),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": not_after.isoformat(),
        "days_remaining": days_left,
        "is_expired": days_left < 0,
        "is_self_signed": is_self_signed(cert),
        "signature_algorithm": cert.signature_hash_algorithm.name if cert.signature_hash_algorithm else None,
        "public_key_type": key_type,
        "public_key_bits": key_bits,
        "sans": subject_alt_names(cert),
    }


def _load_pem_objects(data: bytes, password: Optional[bytes]) -> Tuple[
    List[x509.Certificate], Optional[Any], str
]:
    """Parse one or more PEM blocks. Returns certs, private_key, detected_label."""
    text = data.decode("utf-8", errors="ignore")
    blocks = list(re.finditer(
        r"-----BEGIN ([A-Z0-9 #]+)-----(.*?)-----END \1-----",
        text,
        flags=re.DOTALL,
    ))
    if not blocks:
        raise ValueError("No se encontraron bloques PEM válidos")

    certs: List[x509.Certificate] = []
    key = None
    labels: List[str] = []

    for m in blocks:
        label = m.group(1).strip().upper()
        labels.append(label)
        pem_bytes = m.group(0).encode("utf-8")

        if label in ("CERTIFICATE", "TRUSTED CERTIFICATE", "X509 CERTIFICATE"):
            certs.append(x509.load_pem_x509_certificate(pem_bytes))
        elif label in ("PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY"):
            key = serialization.load_pem_private_key(pem_bytes, password=password)
        elif label in ("PKCS7", "PKCS #7 SIGNED DATA"):
            certs.extend(_load_pkcs7(pem_bytes))
        elif "CERTIFICATE REQUEST" in label:
            raise ValueError("Las CSR no se pueden convertir a certificados; usá un certificado emitido")
        else:
            raise ValueError(f"Bloque PEM no soportado: BEGIN {label}")

    detected = "+".join(dict.fromkeys(labels)) or "pem"
    return certs, key, detected


def _load_pkcs7(data: bytes) -> List[x509.Certificate]:
    try:
        return pkcs7.load_pem_pkcs7_certificates(data)
    except ValueError:
        pass
    try:
        return pkcs7.load_der_pkcs7_certificates(data)
    except ValueError as exc:
        raise ValueError("No se pudo leer el PKCS#7 / P7B") from exc


def _load_pkcs12(data: bytes, password: Optional[bytes]) -> Tuple[
    List[x509.Certificate], Optional[Any], str
]:
    try:
        key, cert, additional = pkcs12.load_key_and_certificates(data, password)
    except ValueError as exc:
        msg = str(exc).lower()
        if password is None and ("password" in msg or "mac" in msg or "invalid" in msg):
            raise ValueError("PKCS#12 / PFX protegido: ingresá la contraseña") from exc
        raise ValueError("No se pudo leer el PKCS#12 / PFX (¿contraseña incorrecta?)") from exc

    certs: List[x509.Certificate] = []
    if cert is not None:
        certs.append(cert)
    if additional:
        certs.extend([c for c in additional if c is not None])
    return certs, key, "pkcs12"


def _try_der_cert(data: bytes) -> Optional[x509.Certificate]:
    try:
        return x509.load_der_x509_certificate(data)
    except ValueError:
        return None


def _try_der_key(data: bytes, password: Optional[bytes]) -> Optional[Any]:
    for loader in (
        lambda: serialization.load_der_private_key(data, password=password),
        lambda: serialization.load_der_public_key(data),
    ):
        try:
            return loader()
        except (ValueError, TypeError):
            continue
    return None


def parse_ssl_material(
    raw: str,
    input_format: str = "auto",
    password: str = "",
    extra_key: str = "",
) -> Dict[str, Any]:
    """Parse certificate/key material from pasted or uploaded content."""
    fmt = (input_format or "auto").lower().strip()
    if fmt not in SUPPORTED_INPUT:
        raise ValueError(f"Formato de entrada no soportado: {input_format}")

    pwd = password.encode("utf-8") if password else None
    data = _decode_input(raw)

    certs: List[x509.Certificate] = []
    key = None
    detected = fmt

    if fmt in ("pfx", "p12"):
        fmt = "pkcs12"
    if fmt == "p7b":
        fmt = "pkcs7"

    if fmt == "auto":
        if data.lstrip().startswith(b"-----BEGIN"):
            certs, key, detected = _load_pem_objects(data, pwd)
        else:
            # Try PKCS#12, PKCS#7, DER cert, DER key
            errors: List[str] = []
            for name, attempt in (
                ("pkcs12", lambda: _load_pkcs12(data, pwd)),
                ("pkcs7", lambda: (_load_pkcs7(data), None, "pkcs7")),
            ):
                try:
                    result = attempt()
                    certs, key, detected = result  # type: ignore[misc]
                    break
                except ValueError as e:
                    errors.append(f"{name}: {e}")
            else:
                cert = _try_der_cert(data)
                if cert is not None:
                    certs, detected = [cert], "der"
                else:
                    key = _try_der_key(data, pwd)
                    if key is not None and hasattr(key, "private_bytes"):
                        detected = "der_key"
                    elif key is not None:
                        raise ValueError(
                            "Se detectó una clave pública DER; se necesita un certificado o clave privada"
                        )
                    else:
                        hint = "; ".join(errors[:2]) if errors else "formato desconocido"
                        raise ValueError(f"No se pudo detectar el formato ({hint})")
    elif fmt == "pem":
        certs, key, detected = _load_pem_objects(data, pwd)
    elif fmt == "der":
        cert = _try_der_cert(data)
        if cert is not None:
            certs, detected = [cert], "der"
        else:
            key = _try_der_key(data, pwd)
            if key is None or not hasattr(key, "private_bytes"):
                raise ValueError("DER inválido: no es un certificado ni una clave privada")
            detected = "der_key"
    elif fmt == "pkcs12":
        certs, key, detected = _load_pkcs12(data, pwd)
    elif fmt == "pkcs7":
        certs = _load_pkcs7(data)
        detected = "pkcs7"
    else:
        raise ValueError(f"Formato de entrada no soportado: {input_format}")

    if extra_key.strip():
        extra_data = _decode_input(extra_key)
        if extra_data.lstrip().startswith(b"-----BEGIN"):
            _, extra_priv, _ = _load_pem_objects(extra_data, pwd)
            if extra_priv is None:
                raise ValueError("El archivo de clave adicional no contiene una clave privada")
            key = extra_priv
        else:
            loaded = _try_der_key(extra_data, pwd)
            if loaded is None or not hasattr(loaded, "private_bytes"):
                raise ValueError("La clave adicional DER no es válida")
            key = loaded

    return {
        "certs": certs,
        "key": key,
        "detected_format": detected,
    }


def _serialize_key_pem(key: Any, traditional_rsa: bool = False) -> bytes:
    if traditional_rsa and hasattr(key, "private_bytes"):
        try:
            return key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        except ValueError:
            pass
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


_KNOWN_EXTS = (
    ".pem", ".der", ".pfx", ".p12", ".p7b", ".p7c", ".crt", ".cer", ".key", ".pkcs12", ".pkcs7",
)


def _safe_basename(name: str, default: str = "certificate") -> str:
    """Sanitize a user-provided name into a filesystem-safe basename (no extension)."""
    base = (name or "").strip()
    if not base:
        return default
    lower = base.lower()
    for ext in _KNOWN_EXTS:
        if lower.endswith(ext):
            base = base[: -len(ext)]
            break
    base = re.sub(r"[^\w.\-]+", "_", base, flags=re.UNICODE).strip("._")
    return base or default


def _output_filename(friendly_name: str, default_stem: str, ext: str) -> str:
    stem = _safe_basename(friendly_name, default_stem)
    return f"{stem}{ext}"


def convert_ssl(
    raw: str,
    output_format: str,
    input_format: str = "auto",
    password: str = "",
    output_password: str = "",
    extra_key: str = "",
    friendly_name: str = "certificate",
) -> Dict[str, Any]:
    """Convert SSL material to the requested output format."""
    out = (output_format or "").lower().strip()
    if out not in SUPPORTED_OUTPUT:
        raise ValueError(
            f"Formato de salida no soportado: {output_format}. "
            f"Opciones: {', '.join(SUPPORTED_OUTPUT)}"
        )

    # Normalize aliases
    if out in ("pfx", "p12"):
        out = "pkcs12"
    if out == "p7b":
        out = "pkcs7"

    parsed = parse_ssl_material(raw, input_format=input_format, password=password, extra_key=extra_key)
    certs: List[x509.Certificate] = parsed["certs"]
    key = parsed["key"]

    needs_cert = out not in ("pem_key", "pem_key_rsa", "der_key")
    needs_key = out in ("pem_key", "pem_key_rsa", "der_key", "pem_bundle", "pkcs12")

    if needs_cert and not certs:
        raise ValueError("Se necesita al menos un certificado para este formato de salida")
    if needs_key and key is None:
        raise ValueError("Se necesita una clave privada (pegala junto al certificado o en el campo de clave)")

    leaf = certs[0] if certs else None
    chain = certs[1:] if len(certs) > 1 else []

    key_matches_certificate: Optional[bool] = None
    if key is not None and leaf is not None:
        key_matches_certificate = keys_match(key, leaf)
        if needs_key and not key_matches_certificate:
            raise ValueError("La clave privada no corresponde al certificado. Verificá que sean del mismo par.")

    bag_name = _safe_basename(friendly_name, "certificate")
    content_type = "application/x-pem-file"
    encoding = "text"
    payload: str
    filename: str

    if out == "pem":
        payload = leaf.public_bytes(serialization.Encoding.PEM).decode("ascii")
        filename = _output_filename(friendly_name, "certificate", ".pem")
    elif out == "pem_full":
        parts = [c.public_bytes(serialization.Encoding.PEM).decode("ascii") for c in certs]
        payload = "".join(parts)
        filename = _output_filename(friendly_name, "fullchain", ".pem")
    elif out == "pem_bundle":
        parts = [
            _serialize_key_pem(key).decode("ascii"),
            leaf.public_bytes(serialization.Encoding.PEM).decode("ascii"),
            *[c.public_bytes(serialization.Encoding.PEM).decode("ascii") for c in chain],
        ]
        payload = "".join(parts)
        filename = _output_filename(friendly_name, "bundle", ".pem")
    elif out == "pem_key":
        payload = _serialize_key_pem(key).decode("ascii")
        filename = _output_filename(friendly_name, "privkey", ".pem")
    elif out == "pem_key_rsa":
        payload = _serialize_key_pem(key, traditional_rsa=True).decode("ascii")
        filename = _output_filename(friendly_name, "privkey-rsa", ".pem")
    elif out == "der":
        raw_bytes = leaf.public_bytes(serialization.Encoding.DER)
        payload = _b64encode(raw_bytes)
        encoding = "base64"
        content_type = "application/pkix-cert"
        filename = _output_filename(friendly_name, "certificate", ".der")
    elif out == "der_key":
        raw_bytes = key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        payload = _b64encode(raw_bytes)
        encoding = "base64"
        content_type = "application/pkcs8"
        filename = _output_filename(friendly_name, "privkey", ".der")
    elif out == "pkcs12":
        out_pwd = output_password.encode("utf-8") if output_password else None
        encryption = (
            serialization.BestAvailableEncryption(out_pwd)
            if out_pwd
            else serialization.NoEncryption()
        )
        raw_bytes = pkcs12.serialize_key_and_certificates(
            name=bag_name.encode("utf-8"),
            key=key,
            cert=leaf,
            cas=chain or None,
            encryption_algorithm=encryption,
        )
        payload = _b64encode(raw_bytes)
        encoding = "base64"
        content_type = "application/x-pkcs12"
        filename = _output_filename(friendly_name, "certificate", ".pfx")
    elif out == "pkcs7":
        # PEM PKCS#7 certificate bag (no private key)
        try:
            raw_bytes = pkcs7.serialize_certificates(certs, serialization.Encoding.PEM)
            payload = raw_bytes.decode("ascii")
            encoding = "text"
            content_type = "application/x-pkcs7-certificates"
            filename = _output_filename(friendly_name, "chain", ".p7b")
        except AttributeError:
            # Fallback: concatenate PEM certs (interoperable for many tools)
            payload = "".join(c.public_bytes(serialization.Encoding.PEM).decode("ascii") for c in certs)
            filename = _output_filename(friendly_name, "chain", ".pem")
            content_type = "application/x-pem-file"
    else:
        raise ValueError(f"Formato de salida no implementado: {out}")

    info_list = [_cert_info(c) for c in certs]
    warnings: List[str] = []
    if info_list:
        leaf_info = info_list[0]
        if leaf_info["is_self_signed"]:
            warnings.append("self_signed")
        if leaf_info["is_expired"]:
            warnings.append("expired")
        elif leaf_info["days_remaining"] < 30:
            warnings.append("expiring_soon")
    if key_matches_certificate is False:
        warnings.append("key_mismatch")

    return {
        "detected_format": parsed["detected_format"],
        "output_format": out if output_format.lower() not in ("pfx", "p12", "p7b") else output_format.lower(),
        "encoding": encoding,
        "content_type": content_type,
        "filename": filename,
        "content": payload,
        "has_private_key": key is not None,
        "key_matches_certificate": key_matches_certificate,
        "certificate_count": len(certs),
        "certificates": info_list,
        "warnings": warnings,
    }


def list_formats() -> Dict[str, Any]:
    return {
        "input": [
            {"id": "auto", "label": "Detección automática", "ext": []},
            {"id": "pem", "label": "PEM (.pem, .crt, .cer)", "ext": [".pem", ".crt", ".cer", ".key"]},
            {"id": "der", "label": "DER (.der, .cer)", "ext": [".der", ".cer"]},
            {"id": "pkcs12", "label": "PKCS#12 / PFX / P12", "ext": [".p12", ".pfx", ".pkcs12"]},
            {"id": "pkcs7", "label": "PKCS#7 / P7B", "ext": [".p7b", ".p7c", ".pkcs7"]},
        ],
        "output": [
            {"id": "pem", "label": "PEM — certificado", "ext": ".pem", "needs_key": False},
            {"id": "pem_full", "label": "PEM — fullchain (cert + cadena)", "ext": ".pem", "needs_key": False},
            {"id": "pem_bundle", "label": "PEM — bundle (key + cert + cadena)", "ext": ".pem", "needs_key": True},
            {"id": "pem_key", "label": "PEM — clave privada (PKCS#8)", "ext": ".pem", "needs_key": True},
            {"id": "pem_key_rsa", "label": "PEM — clave RSA (PKCS#1)", "ext": ".pem", "needs_key": True},
            {"id": "der", "label": "DER — certificado", "ext": ".der", "needs_key": False},
            {"id": "der_key", "label": "DER — clave privada", "ext": ".der", "needs_key": True},
            {"id": "pkcs12", "label": "PKCS#12 / PFX", "ext": ".pfx", "needs_key": True},
            {"id": "pkcs7", "label": "PKCS#7 / P7B", "ext": ".p7b", "needs_key": False},
        ],
    }
