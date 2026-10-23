import ipaddress

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter()


def client_ip(request: Request) -> str:
    candidates = [
        request.headers.get("cf-connecting-ip", ""),
        request.headers.get("x-real-ip", ""),
        request.headers.get("x-forwarded-for", "").split(",")[0],
        request.client.host if request.client else "",
    ]
    for raw in candidates:
        raw = raw.strip()
        try:
            return str(ipaddress.ip_address(raw))
        except ValueError:
            continue
    return ""


@router.get("/ip", response_class=PlainTextResponse)
async def my_ip(request: Request):
    return client_ip(request) + "\n"


@router.get("/all")
async def my_all(request: Request):
    h = request.headers
    return {
        "ip_addr": client_ip(request),
        "remote_host": h.get("x-forwarded-host") or h.get("host", ""),
        "user_agent": h.get("user-agent", ""),
        "port": request.client.port if request.client else None,
        "language": h.get("accept-language", ""),
        "method": request.method,
        "encoding": h.get("accept-encoding", ""),
        "mime": h.get("accept", ""),
        "via": h.get("via", ""),
        "forwarded": h.get("x-forwarded-for", ""),
    }
