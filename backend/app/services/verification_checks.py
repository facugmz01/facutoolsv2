from __future__ import annotations

import asyncio
import datetime as dt
import re
import sys
import socket
import ssl
import time
import xml.etree.ElementTree as ET
from typing import Any

import httpx
import whois


DEFAULT_TIMEOUT = 5.0


def _result(
    status: str,
    started: float,
    details: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        "details": details or {},
        "error_message": error_message,
    }


async def check_ssl(host: str, port: int = 443) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        context = ssl.create_default_context()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=context, server_hostname=host),
            timeout=DEFAULT_TIMEOUT,
        )
        try:
            certificate = writer.get_extra_info("peercert") or {}
            expires_at = dt.datetime.strptime(
                certificate["notAfter"], "%b %d %H:%M:%S %Y %Z"
            ).replace(tzinfo=dt.timezone.utc)
            days_remaining = (expires_at - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400
            severity = "CRITICAL" if days_remaining < 7 else "WARNING" if days_remaining < 15 else "OK"
            status = "DOWN" if days_remaining < 7 else "WARNING" if days_remaining < 15 else "UP"
            return _result(
                status,
                started,
                {
                    "host": host,
                    "port": port,
                    "subject": certificate.get("subject"),
                    "issuer": certificate.get("issuer"),
                    "expires_at": expires_at.isoformat(),
                    "days_remaining": round(days_remaining, 2),
                    "severity": severity,
                },
            )
        finally:
            writer.close()
            await writer.wait_closed()
    except Exception as exc:
        return _result("DOWN", started, {"host": host, "port": port}, str(exc)[:500])


async def check_tcp_port(host: str, port: int, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    started = time.perf_counter()
    writer = None
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        return _result("UP", started, {"host": host, "port": port})
    except Exception as exc:
        return _result("DOWN", started, {"host": host, "port": port}, str(exc)[:500])
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()


async def check_ping(host: str, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Run one ICMP echo through the platform ping binary without a shell."""
    started = time.perf_counter()
    if sys.platform == "darwin":
        command = ("ping", "-c", "1", "-W", str(max(1, int(timeout * 1000))), host)
    else:
        command = ("ping", "-c", "1", "-W", str(max(1, int(timeout))), host)
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout + 1)
        output = (stdout + stderr).decode(errors="replace")
        match = re.search(r"time[=<]([0-9]+(?:\.[0-9]+)?)", output)
        if process.returncode == 0:
            details = {"host": host, "packet_loss_percent": 0, "output": output[-500:]}
            if match:
                details["ping_time_ms"] = float(match.group(1))
            return _result("UP", started, details)
        return _result("DOWN", started, {"host": host, "packet_loss_percent": 100}, output[-500:] or "Ping fallido")
    except asyncio.TimeoutError:
        if process is not None:
            process.kill()
            await process.wait()
        return _result("DOWN", started, {"host": host, "packet_loss_percent": 100}, "Timeout de ping")
    except Exception as exc:
        return _result("DOWN", started, {"host": host}, str(exc)[:500])


async def check_http_keyword(
    url: str, keyword: str, must_contain: bool = True
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url)
        matched = keyword in response.text
        condition_met = matched if must_contain else not matched
        status = "UP" if response.status_code < 500 and condition_met else "DOWN"
        error_message = None if condition_met else "La condición del keyword no se cumplió"
        return _result(
            status,
            started,
            {
                "url": str(response.url),
                "status_code": response.status_code,
                "content_type": response.headers.get("content-type"),
                "keyword": keyword,
                "matched": matched,
                "must_contain": must_contain,
            },
            error_message,
        )
    except Exception as exc:
        return _result("DOWN", started, {"url": url, "keyword": keyword}, str(exc)[:500])


async def check_wordpress(url: str, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Validate a WordPress site through its public REST API root."""
    started = time.perf_counter()
    api_url = url.rstrip("/")
    if not api_url.endswith("/wp-json"):
        api_url = f"{api_url}/wp-json"
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(api_url, headers={"Accept": "application/json"})
        details = {
            "url": str(response.url),
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type"),
        }
        if response.status_code in (401, 403):
            return _result("WARNING", started, details, "La API REST de WordPress requiere autenticación")
        if response.status_code >= 500:
            return _result("DOWN", started, details, f"WordPress respondió HTTP {response.status_code}")
        if response.status_code >= 400:
            return _result("DOWN", started, details, f"Endpoint WordPress respondió HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError:
            return _result("DOWN", started, details, "La respuesta no es JSON válido de WordPress")
        is_wordpress = isinstance(payload, dict) and bool(
            payload.get("routes") or payload.get("name") or payload.get("_links")
        )
        details["wordpress_detected"] = is_wordpress
        details["site_name"] = payload.get("name") if isinstance(payload, dict) else None
        if not is_wordpress:
            return _result("DOWN", started, details, "La respuesta no parece ser la API REST de WordPress")
        return _result("UP", started, details)
    except Exception as exc:
        return _result("DOWN", started, {"url": api_url}, str(exc)[:500])


async def check_soap(
    url: str,
    soap_action: str,
    request_body: str,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Send a SOAP 1.1 request and report HTTP/SOAP Fault failures."""
    started = time.perf_counter()
    try:
        # AFIP's legacy endpoint still negotiates a small DH group.
        tls_context = ssl.create_default_context()
        try:
            tls_context.set_ciphers("DEFAULT:@SECLEVEL=1")
        except ssl.SSLError:
            pass
        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": soap_action,
        }
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            verify=tls_context,
        ) as client:
            response = await client.post(url, content=request_body.encode("utf-8"), headers=headers)
        body = response.text
        fault = bool(re.search(r"<(?:\w+:)?Fault(?:\s|>)", body, re.IGNORECASE))
        service_status: dict[str, str] = {}
        try:
            root = ET.fromstring(body)
            for element in root.iter():
                name = element.tag.rsplit("}", 1)[-1]
                if name in {"AppServer", "DbServer", "AuthServer"} and element.text:
                    service_status[name] = element.text.strip().upper()
        except ET.ParseError:
            pass
        components_ok = bool(service_status) and all(value == "OK" for value in service_status.values())
        components_failed = bool(service_status) and not components_ok
        status = "UP" if 200 <= response.status_code < 300 and not fault and not components_failed else "DOWN"
        error_message = "SOAP Fault devuelto por el servicio" if fault else None
        if components_failed:
            error_message = "AFIP reportó un componente no disponible"
        if response.status_code >= 400 and error_message is None:
            error_message = f"Respuesta HTTP {response.status_code}"
        return _result(
            status,
            started,
            {
                "url": str(response.url),
                "status_code": response.status_code,
                "content_type": response.headers.get("content-type"),
                "soap_action": soap_action,
                "fault": fault,
                "service_status": service_status,
                "components_ok": components_ok,
                "response_preview": body[:500],
            },
            error_message,
        )
    except Exception as exc:
        return _result("DOWN", started, {"url": url, "soap_action": soap_action}, str(exc)[:500])


def _expiration_date(value: Any) -> dt.datetime | None:
    if isinstance(value, (list, tuple)):
        value = next((item for item in value if item), None)
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if isinstance(value, dt.date):
        return dt.datetime.combine(value, dt.time(), tzinfo=dt.timezone.utc)
    return None


async def check_whois_expiration(domain: str) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        data = await asyncio.to_thread(whois.whois, domain)
        expires_at = _expiration_date(getattr(data, "expiration_date", None))
        if expires_at is None:
            return _result("WARNING", started, {"domain": domain}, "WHOIS no devolvió fecha de expiración")
        days_remaining = (expires_at - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400
        severity = "CRITICAL" if days_remaining < 7 else "WARNING" if days_remaining < 15 else "OK"
        status = "DOWN" if days_remaining < 7 else "WARNING" if days_remaining < 15 else "UP"
        return _result(
            status,
            started,
            {
                "domain": domain,
                "expires_at": expires_at.isoformat(),
                "days_remaining": round(days_remaining, 2),
                "severity": severity,
            },
        )
    except Exception as exc:
        return _result("DOWN", started, {"domain": domain}, str(exc)[:500])