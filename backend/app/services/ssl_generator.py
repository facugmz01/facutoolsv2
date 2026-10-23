"""ACME/Let's Encrypt SSL certificate generation and self-signed issuance."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography import x509
from cryptography.x509.oid import NameOID

from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)


def _format_acme_problem(err: Any) -> str:
    """Format a single ACME problem document / Error object."""
    if err is None:
        return ""
    detail = getattr(err, "detail", None) or getattr(err, "description", None)
    typ = getattr(err, "typ", None) or getattr(err, "type", None) or getattr(err, "title", None)
    bits: List[str] = []
    if detail:
        bits.append(str(detail).strip())
    if typ:
        typ_s = str(typ).strip()
        # Prefer short name: urn:ietf:params:acme:error:unauthorized → unauthorized
        if ":" in typ_s:
            typ_s = typ_s.rsplit(":", 1)[-1]
        if typ_s and typ_s not in (bits[0] if bits else ""):
            bits.append(f"({typ_s})")
    if bits:
        return " ".join(bits)
    text = str(err).strip()
    return text


def format_validation_authzrs(failed_authzrs: Sequence[Any]) -> str:
    """Extract human-readable reasons from failed ACME authorizations."""
    bits: List[str] = []
    for authzr in failed_authzrs or ():
        body = getattr(authzr, "body", authzr)
        ident = getattr(getattr(body, "identifier", None), "value", None) or "?"
        auth_err = _format_acme_problem(getattr(body, "error", None))
        if auth_err:
            bits.append(f"{ident}: {auth_err}")
            continue
        for challb in getattr(body, "challenges", None) or ():
            chall_err = _format_acme_problem(getattr(challb, "error", None))
            if chall_err:
                bits.append(f"{ident}: {chall_err}")
                break
        else:
            status = getattr(body, "status", None)
            if status is not None:
                bits.append(f"{ident}: authorization {status}")
    return "; ".join(bits)


def format_acme_error(exc: BaseException) -> str:
    """Build a human-readable ACME / cryptography error string."""
    failed = getattr(exc, "failed_authzrs", None)
    if failed:
        detail = format_validation_authzrs(failed)
        if detail:
            return detail

    parts: List[str] = []
    code = getattr(exc, "code", None)
    detail = getattr(exc, "detail", None)
    description = getattr(exc, "description", None)
    typ = getattr(exc, "typ", None)
    location = getattr(exc, "location", None)
    if code:
        parts.append(str(code))
    if detail:
        parts.append(str(detail))
    elif description:
        parts.append(str(description))
    if typ and not parts:
        parts.append(str(typ))
    if location and not parts:
        parts.append(f"existing account at {location}")
    if parts:
        return " — ".join(parts)
    text = str(exc).strip()
    if text:
        return text
    return repr(exc) or exc.__class__.__name__


def normalize_cert_names(hostname: str, wildcard: bool = False) -> List[str]:
    """Build the hostname list for a certificate request.

    Exactly one scope is emitted:
    - ``wildcard=False`` → only the apex / given hostname
    - ``wildcard=True`` → only ``*.apex`` (does not include the bare domain)
    """
    host = hostname.strip().lower().rstrip(".")
    if host.startswith("*."):
        apex = host[2:]
        return [f"*.{apex}"] if wildcard else [apex]
    if wildcard:
        return [f"*.{host}"]
    return [host]


def primary_hostname(names: Sequence[str]) -> str:
    """Prefer the wildcard label as the stored hostname when present."""
    for name in names:
        if name.startswith("*."):
            return name
    return names[0]


def dns_challenge_host(identifier: str) -> str:
    """TXT record host for DNS-01 (wildcards strip the ``*.`` label)."""
    host = identifier.strip().lower().rstrip(".")
    if host.startswith("*."):
        host = host[2:]
    return f"_acme-challenge.{host}"


def safe_fs_name(hostname: str) -> str:
    return hostname.replace("*", "wildcard").replace(".", "_")


class SSLGenerator:
    """Reads Let's Encrypt / ACME options live from SettingsStore on every use."""

    def __init__(self):
        self._sync_from_settings()

    def _sync_from_settings(self) -> None:
        """Refresh paths and ACME endpoints from Settings (DB-backed)."""
        self.directory_url = SettingsStore.get_str(
            "acme_directory_url",
            "https://acme-staging-v02.api.letsencrypt.org/directory",
        ).strip()
        self.email = SettingsStore.get_str("acme_email", "").strip()
        self.certs_path = Path(SettingsStore.get_str("certs_storage_path", "./data/certs"))
        self.certs_path.mkdir(parents=True, exist_ok=True)
        self.orders_path = self.certs_path / "orders"
        self.orders_path.mkdir(parents=True, exist_ok=True)

        # Separate account keys for staging vs production directories
        directory = self.directory_url
        if "acme-v02.api.letsencrypt.org" in directory and "staging" not in directory:
            host = "production"
        elif "staging" in directory:
            host = "staging"
        else:
            host = safe_fs_name(directory.replace("https://", "").replace("/", "_"))[:80] or "acme"
        self.account_key_path = self.certs_path / f"acme_account_{host}.key"
        # Keep legacy key as fallback if present and new one missing
        legacy = self.certs_path / "acme_account.key"
        if host == "staging" and legacy.exists() and not self.account_key_path.exists():
            self.account_key_path = legacy

    def _order_paths(self, hostname: str) -> tuple[Path, Path]:
        base = safe_fs_name(hostname)
        return self.orders_path / f"{base}.key", self.orders_path / f"{base}.json"

    def _get_or_create_account_key(self):
        if self.account_key_path.exists():
            return serialization.load_pem_private_key(
                self.account_key_path.read_bytes(), password=None
            )
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.account_key_path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        return key

    def _get_or_create_domain_key(self, hostname: str):
        key_path, _ = self._order_paths(hostname)
        if key_path.exists():
            return serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        key_path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        return key

    def _private_key_pem(self, key) -> bytes:
        return key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def _account_jwk(self):
        import josepy as jose

        return jose.JWKRSA(key=self._get_or_create_account_key())

    def _acme_client(self):
        """Build a ready ACME ClientV2 using Settings → SSL / ACME."""
        from acme import client as acme_client
        from acme import messages

        self._sync_from_settings()

        email = (self.email or "").strip()
        if not email or "@" not in email:
            raise ValueError(
                "Configure ACME Email in Settings → SSL / ACME before requesting Let's Encrypt certificates."
            )
        domain = email.rsplit("@", 1)[-1].lower()
        if domain in {"example.com", "example.org", "example.net", "localhost", "test"}:
            raise ValueError(
                f"Let's Encrypt rejects contact emails on '{domain}'. "
                "Set a real ACME Email in Settings → SSL / ACME."
            )
        if not self.directory_url:
            raise ValueError(
                "Configure ACME Directory URL in Settings → SSL / ACME "
                "(staging or production Let's Encrypt endpoint)."
            )

        account_key = self._account_jwk()
        net = acme_client.ClientNetwork(account_key, user_agent="domaintools/1.0")
        try:
            directory = messages.Directory.from_json(net.get(self.directory_url).json())
        except Exception as exc:
            raise ValueError(
                f"Could not reach ACME directory ({self.directory_url}): {format_acme_error(exc)}"
            ) from exc

        client = acme_client.ClientV2(directory, net=net)

        # Boulder returns HTTP 200 (+ Location) when the account key is already
        # registered; the acme ClientV2 raises ConflictError and does not bind
        # net.account — recover by querying the existing registration.
        from acme import errors as acme_errors

        try:
            client.new_account(
                messages.NewRegistration.from_data(
                    email=email,
                    terms_of_service_agreed=True,
                )
            )
        except acme_errors.ConflictError as conflict:
            client.query_registration(
                messages.RegistrationResource(
                    body=messages.Registration(),
                    uri=conflict.location,
                )
            )
        except messages.Error as exc:
            code = str(getattr(exc, "code", "") or "")
            typ = str(getattr(exc, "typ", "") or "")
            if code in {"invalidContact", "rejectedIdentifier", "unsupportedContact"} or any(
                token in typ for token in ("invalidContact", "rejectedIdentifier", "unsupportedContact")
            ):
                raise ValueError(format_acme_error(exc)) from exc

            try:
                # Key may already be registered without a usable Location path above
                existing = messages.NewRegistration.from_data(terms_of_service_agreed=True)
                existing = existing.update(only_return_existing=True)
                # only_return_existing also returns HTTP 200 → ConflictError in this acme version
                try:
                    client.new_account(existing)
                except acme_errors.ConflictError as conflict:
                    client.query_registration(
                        messages.RegistrationResource(
                            body=messages.Registration(),
                            uri=conflict.location,
                        )
                    )
            except messages.Error as exc2:
                code2 = str(getattr(exc2, "code", "") or "")
                if code2 == "accountDoesNotExist":
                    raise ValueError(format_acme_error(exc)) from exc
                raise ValueError(format_acme_error(exc2)) from exc2

        if client.net.account is None:
            raise ValueError("ACME account was not bound after registration.")

        return client, account_key

    def _load_order_state(self, hostname: str) -> dict:
        _, order_data_path = self._order_paths(hostname)
        if not order_data_path.exists():
            raise ValueError("No pending ACME order found. Request the certificate again.")
        return json.loads(order_data_path.read_text())

    def _save_order_state(self, hostname: str, data: dict) -> None:
        _, order_data_path = self._order_paths(hostname)
        order_data_path.write_text(json.dumps(data, indent=2))

    def _clear_order_state(self, hostname: str) -> None:
        _, order_data_path = self._order_paths(hostname)
        order_data_path.unlink(missing_ok=True)

    def _dns_challenges_from_order(self, client, account_key, order) -> List[Dict[str, str]]:
        from acme import challenges

        records: List[Dict[str, str]] = []
        for authzr in order.authorizations:
            identifier = authzr.body.identifier.value
            for challb in authzr.body.challenges:
                if not isinstance(challb.chall, challenges.DNS01):
                    continue
                _response, validation = challb.chall.response_and_validation(account_key)
                records.append({
                    "dns_name": dns_challenge_host(identifier),
                    "dns_value": validation,
                    "identifier": identifier,
                    "challenge_uri": challb.uri,
                    "auth_uri": authzr.uri,
                    "token": challb.chall.encode("token"),
                })
        if not records:
            raise ValueError("Let's Encrypt did not offer a DNS-01 challenge for this order")
        return records

    def initiate_order(
        self,
        hostname: str,
        challenge_type: str = "dns-01",
        wildcard: bool = False,
        names: Optional[Sequence[str]] = None,
    ) -> Dict:
        """Initiate a real ACME order and return DNS-01 challenge record(s)."""
        if challenge_type != "dns-01":
            raise ValueError("Only dns-01 challenges are supported")

        domains = list(names) if names else normalize_cert_names(hostname, wildcard=wildcard)
        primary = primary_hostname(domains)

        self._sync_from_settings()

        from acme import crypto_util

        try:
            client, account_key = self._acme_client()
            domain_key = self._get_or_create_domain_key(primary)
            csr_pem = crypto_util.make_csr(self._private_key_pem(domain_key), domains)
            order = client.new_order(csr_pem)
            records = self._dns_challenges_from_order(client, account_key, order)
        except ValueError:
            raise
        except Exception as exc:
            logger.exception("ACME initiate_order failed for %s", primary)
            raise ValueError(format_acme_error(exc)) from exc

        self._save_order_state(primary, {
            "hostname": primary,
            "names": domains,
            "wildcard": any(n.startswith("*.") for n in domains),
            "order_uri": order.uri,
            "csr_pem": csr_pem.decode("ascii"),
            "challenges": records,
            "mode": "acme",
            "directory_url": self.directory_url,
            "created_at": datetime.utcnow().isoformat() + "Z",
        })

        # Primary record for simple UIs; full list under "challenges"
        first = records[0]
        return {
            "dns_name": first["dns_name"],
            "dns_value": first["dns_value"],
            "challenges": records,
            "hostname": primary,
            "names": domains,
            "wildcard": any(n.startswith("*.") for n in domains),
        }

    def _restore_order(self, client, order_data: dict):
        from acme import messages

        order_uri = order_data.get("order_uri")
        csr_pem = (order_data.get("csr_pem") or "").encode("ascii")
        if not order_uri or not csr_pem:
            raise ValueError(
                "Pending order is incomplete or was created with an old flow. "
                "Request the Let's Encrypt certificate again."
            )
        if order_data.get("mode") == "manual":
            raise ValueError(
                "This pending request used a local fallback challenge, not Let's Encrypt. "
                "Request the certificate again to start a real ACME order."
            )

        response = client._post_as_get(order_uri)
        body = messages.Order.from_json(response.json())
        authorizations = []
        for url in body.authorizations:
            authorizations.append(
                client._authzr_from_response(client._post_as_get(url), uri=url)
            )
        return messages.OrderResource(
            body=body,
            uri=order_uri,
            authorizations=authorizations,
            csr_pem=csr_pem,
        )

    def finalize_order(self, hostname: str, challenge_type: str = "dns-01") -> Dict:
        """Answer DNS-01 challenges on the existing ACME order and download the cert."""
        if challenge_type != "dns-01":
            raise ValueError("Only dns-01 challenges are supported")

        from acme import challenges
        import datetime as dt

        order_data = self._load_order_state(hostname)
        names = order_data.get("names") or [hostname]
        self._sync_from_settings()
        client, account_key = self._acme_client()
        order = self._restore_order(client, order_data)

        from acme import messages as acme_messages

        # Dead orders cannot be recovered — LE keeps them invalid forever.
        if order.body.status == acme_messages.STATUS_INVALID:
            reason = format_validation_authzrs(order.authorizations) or "order is invalid"
            raise ValueError(
                f"Let's Encrypt order already failed: {reason}. "
                "Publish the TXT value without quotes, wait for DNS propagation, "
                "then Request a new certificate (this order cannot be completed)."
            )

        # Tell LE we've placed the TXT records
        for authzr in order.authorizations:
            if authzr.body.status in (acme_messages.STATUS_VALID, acme_messages.STATUS_INVALID):
                continue
            for challb in authzr.body.challenges:
                if not isinstance(challb.chall, challenges.DNS01):
                    continue
                if challb.status in (acme_messages.STATUS_VALID, acme_messages.STATUS_INVALID):
                    continue
                response, _validation = challb.chall.response_and_validation(account_key)
                client.answer_challenge(challb, response)

        deadline = dt.datetime.now() + dt.timedelta(seconds=180)
        try:
            finalized = client.poll_and_finalize(order, deadline)
        except Exception as exc:
            logger.exception("ACME poll_and_finalize failed for %s", hostname)
            detail = format_acme_error(exc)
            raise ValueError(
                f"Let's Encrypt validation failed: {detail}. "
                "Confirm the TXT record is published exactly as shown (no surrounding quotes), "
                "wait for propagation, then try Complete again. If the order is already invalid, Request a new certificate."
            ) from exc

        cert_pem = finalized.fullchain_pem
        if not cert_pem:
            raise ValueError("Let's Encrypt finalized the order but returned an empty certificate")

        domain_key = self._get_or_create_domain_key(hostname)
        key_pem = self._private_key_pem(domain_key).decode()

        # Prefer not_after from the leaf if parseable
        expires_at = datetime.utcnow() + timedelta(days=90)
        try:
            leaf = x509.load_pem_x509_certificate(cert_pem.encode() if isinstance(cert_pem, str) else cert_pem)
            expires_at = getattr(leaf, "not_valid_after_utc", None) or leaf.not_valid_after
            if getattr(expires_at, "tzinfo", None) is not None:
                expires_at = expires_at.replace(tzinfo=None)
        except Exception:
            pass

        self._clear_order_state(hostname)
        return {
            "certificate": cert_pem if isinstance(cert_pem, str) else cert_pem.decode(),
            "private_key": key_pem,
            "expires_at": expires_at,
            "hostname": hostname,
            "names": names,
            "wildcard": any(n.startswith("*.") for n in names),
            "self_signed": False,
        }

    def generate_self_signed(
        self,
        hostnames: Sequence[str],
        days: int = 365,
    ) -> Dict:
        """Issue a self-signed certificate covering one or more hostnames (incl. wildcards)."""
        self._sync_from_settings()
        names = list(hostnames)
        if not names:
            raise ValueError("At least one hostname is required")
        primary = primary_hostname(names)
        domain_key = self._get_or_create_domain_key(primary)

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, primary),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "FacuTools"),
        ])

        san = x509.SubjectAlternativeName([x509.DNSName(n) for n in names])
        not_before = datetime.utcnow() - timedelta(minutes=1)
        not_after = datetime.utcnow() + timedelta(days=max(1, days))

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(domain_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(not_before)
            .not_valid_after(not_after)
            .add_extension(san, critical=False)
            .add_extension(
                x509.BasicConstraints(ca=False, path_length=None),
                critical=True,
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_encipherment=True,
                    content_commitment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),
                critical=False,
            )
            .sign(domain_key, hashes.SHA256())
        )

        cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
        key_pem = self._private_key_pem(domain_key).decode()
        self._clear_order_state(primary)

        return {
            "certificate": cert_pem,
            "private_key": key_pem,
            "expires_at": not_after,
            "hostname": primary,
            "names": names,
            "wildcard": any(n.startswith("*.") for n in names),
            "self_signed": True,
        }

    # Backwards-compatible helpers (no longer used as silent LE fallbacks)
    def _initiate_order_fallback(self, hostname: str, names: Optional[Sequence[str]] = None) -> Dict:
        raise RuntimeError(
            "ACME initiation fallback is disabled. Fix Let's Encrypt connectivity/settings and retry."
        )

    def _finalize_order_fallback(self, hostname: str) -> Dict:
        raise RuntimeError(
            "ACME finalize fallback is disabled. Complete a real Let's Encrypt order instead."
        )
