import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from app.auth.deps import require_permissions
from pydantic import BaseModel, Field

from app.services.blacklist_extended import check_ip_blacklists
from app.services.dns_checker import check_dns
from app.services.dns_propagation import check_propagation
from app.services.ip_lookup import lookup_ip, resolve_to_ip
from app.services.mac_lookup import lookup_mac
from app.services.rdap_whois import lookup_rdap
from app.services.port_checker import check_ports, stream_port_scan
from app.services.smtp_tester import test_smtp
from app.services.ssl_converter import convert_ssl, list_formats

router = APIRouter(dependencies=[Depends(require_permissions("network:use"))])


class SmtpTestRequest(BaseModel):
    host: str
    port: int = 25
    user: str = ""
    password: str = ""
    mail_from: str = ""
    rcpt_to: str = ""
    security: str = "auto"
    send_message: bool = False
    subject: str = "DomainTools SMTP test"
    body: str = "This is a test message from the DomainTools SMTP tester."


class PortCheckRequest(BaseModel):
    host: str
    protocol: str = "tcp"
    mode: str = "manual"
    preset: Optional[str] = None
    ports: Optional[str] = None
    timeout: float = 1.0
    concurrency: int = 64


class SslConvertRequest(BaseModel):
    content: str = Field(..., min_length=1, description="Certificado/clave en PEM, Base64 o Hex")
    output_format: str = Field(..., description="Formato de salida")
    input_format: str = "auto"
    password: str = ""
    output_password: str = ""
    extra_key: str = ""
    friendly_name: str = "certificate"


def _handle_value_error(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/ip")
async def ip_lookup_me(request: Request):
    client_ip = (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else None)
    )
    try:
        return await lookup_ip(client_ip=client_ip)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/ip/{target}")
async def ip_lookup(target: str):
    try:
        return await lookup_ip(ip=target)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/blacklist/{ip}")
async def blacklist_check(ip: str):
    try:
        return await check_ip_blacklists(ip)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/dns/{domain}")
async def dns_check(domain: str):
    try:
        return await check_dns(domain)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/rdap/{domain}")
async def rdap_lookup(domain: str):
    try:
        return await lookup_rdap(domain)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/propagation/{domain}")
async def propagation_check(domain: str, type: str = "A"):
    try:
        return await check_propagation(domain, type)
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/mac/{mac}")
async def mac_lookup(mac: str):
    try:
        return await lookup_mac(mac)
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/smtp-test")
async def smtp_test(body: SmtpTestRequest):
    try:
        return await test_smtp(
            host=body.host, port=body.port, user=body.user, password=body.password,
            mail_from=body.mail_from, rcpt_to=body.rcpt_to, security=body.security,
            send_message=body.send_message, subject=body.subject, body=body.body,
        )
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/port-check")
async def port_check(body: PortCheckRequest):
    try:
        return await check_ports(
            host=body.host,
            protocol=body.protocol,  # type: ignore[arg-type]
            mode=body.mode,  # type: ignore[arg-type]
            preset=body.preset,
            ports=body.ports,
            timeout=body.timeout,
            concurrency=body.concurrency,
        )
    except ValueError as e:
        raise _handle_value_error(e)


@router.post("/port-check/stream")
async def port_check_stream(body: PortCheckRequest):
    try:
        start, events = await stream_port_scan(
            host=body.host,
            protocol=body.protocol,  # type: ignore[arg-type]
            mode=body.mode,  # type: ignore[arg-type]
            preset=body.preset,
            ports=body.ports,
            timeout=body.timeout,
            concurrency=body.concurrency,
        )
    except ValueError as e:
        raise _handle_value_error(e)

    async def body_iter():
        yield json.dumps(start) + "\n"
        async for event in events:
            yield json.dumps(event) + "\n"

    return StreamingResponse(
        body_iter(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/ssl-convert/formats")
async def ssl_convert_formats():
    return list_formats()


@router.post("/ssl-convert")
async def ssl_convert(body: SslConvertRequest):
    try:
        return convert_ssl(
            raw=body.content,
            output_format=body.output_format,
            input_format=body.input_format,
            password=body.password,
            output_password=body.output_password,
            extra_key=body.extra_key,
            friendly_name=body.friendly_name,
        )
    except ValueError as e:
        raise _handle_value_error(e)


@router.get("/resolve/{target}")
async def resolve_target(target: str):
    """Resuelve dominio a IP (usado internamente por IP Lookup + Blacklist)."""
    try:
        ip = await resolve_to_ip(target)
        return {"ip": ip}
    except ValueError as e:
        raise _handle_value_error(e)
