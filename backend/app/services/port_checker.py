from __future__ import annotations

import asyncio
import re
import socket
import ssl
import time
from typing import AsyncIterator, Literal

from app.services.network_utils import is_valid_ipv4

MAX_PORTS = 1024
DEFAULT_TIMEOUT = 1.0
DEFAULT_CONCURRENCY = 64

Protocol = Literal["tcp", "udp", "both"]

SERVICE_NAMES: dict[int, str] = {
    20: "ftp-data",
    21: "ftp",
    22: "ssh",
    23: "telnet",
    25: "smtp",
    53: "dns",
    80: "http",
    110: "pop3",
    111: "rpcbind",
    135: "msrpc",
    139: "netbios-ssn",
    143: "imap",
    443: "https",
    445: "smb",
    465: "smtps",
    587: "submission",
    993: "imaps",
    995: "pop3s",
    1433: "mssql",
    1521: "oracle",
    3306: "mysql",
    3389: "rdp",
    5432: "postgresql",
    5900: "vnc",
    6379: "redis",
    8000: "http-alt",
    8080: "http-proxy",
    8443: "https-alt",
    27017: "mongodb",
}

PRESETS: dict[str, list[int]] = {
    "common": [
        21, 22, 23, 25, 53, 80, 110, 135, 139, 143,
        443, 445, 465, 587, 993, 995, 3306, 3389, 5432, 8080,
    ],
    "web": [80, 443, 3000, 5000, 8000, 8080, 8443, 8888],
    "mail": [25, 110, 143, 465, 587, 993, 995],
    "db": [1433, 1521, 3306, 5432, 6379, 27017],
    "top100": [
        7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111,
        113, 119, 135, 139, 143, 144, 179, 199, 389, 427, 443, 444, 445, 465,
        513, 514, 515, 543, 544, 548, 554, 587, 631, 646, 873, 990, 993, 995,
        1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723, 1755, 1900,
        2000, 2049, 2121, 2717, 3000, 3128, 3306, 3389, 3986, 4899, 5000,
        5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631, 5666, 5800, 5900,
        6000, 6001, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888,
        9100, 9999, 10000, 32768, 49152, 49153, 49154,
    ],
    "well_known": list(range(1, 1025)),
}


def _parse_ports(spec: str) -> list[int]:
    """Parse '80', '80,443', '20-25' or mixed into a sorted unique port list."""
    ports: set[int] = set()
    raw = (spec or "").strip()
    if not raw:
        raise ValueError("Debés indicar al menos un puerto o rango")

    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            ends = token.split("-", 1)
            if len(ends) != 2 or not ends[0].strip().isdigit() or not ends[1].strip().isdigit():
                raise ValueError(f"Rango inválido: {token}")
            start, end = int(ends[0]), int(ends[1])
            if start > end:
                start, end = end, start
            if start < 1 or end > 65535:
                raise ValueError("Los puertos deben estar entre 1 y 65535")
            if end - start + 1 > MAX_PORTS:
                raise ValueError(f"El rango no puede superar {MAX_PORTS} puertos")
            ports.update(range(start, end + 1))
        else:
            if not token.isdigit():
                raise ValueError(f"Puerto inválido: {token}")
            port = int(token)
            if port < 1 or port > 65535:
                raise ValueError("Los puertos deben estar entre 1 y 65535")
            ports.add(port)

    if not ports:
        raise ValueError("Debés indicar al menos un puerto o rango")
    if len(ports) > MAX_PORTS:
        raise ValueError(f"Máximo {MAX_PORTS} puertos por escaneo")
    return sorted(ports)


def _resolve_host(host: str) -> tuple[str, str]:
    target = host.strip()
    if not target:
        raise ValueError("La IP o hostname es obligatorio")
    target = target.split("/")[0].split("?")[0]
    if target.lower().startswith(("http://", "https://")):
        target = target.split("://", 1)[1]
    target = target.split(":")[0].rstrip(".")

    if is_valid_ipv4(target):
        return target, target

    try:
        infos = socket.getaddrinfo(target, None, socket.AF_INET, socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ValueError(f"No se pudo resolver el host: {target}") from e
    if not infos:
        raise ValueError(f"No se pudo resolver el host: {target}")
    ip = infos[0][4][0]
    return target, ip


def _check_tcp(ip: str, port: int, timeout: float) -> dict:
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        code = sock.connect_ex((ip, port))
        ms = round((time.perf_counter() - started) * 1000)
        if code == 0:
            return {"port": port, "protocol": "tcp", "status": "open", "ms": ms,
                    "service": SERVICE_NAMES.get(port)}
        # Timeout-ish errno varies; treat long waits as filtered
        if ms >= int(timeout * 1000) - 50:
            return {"port": port, "protocol": "tcp", "status": "filtered", "ms": None,
                    "service": SERVICE_NAMES.get(port)}
        return {"port": port, "protocol": "tcp", "status": "closed", "ms": ms,
                "service": SERVICE_NAMES.get(port)}
    except socket.timeout:
        return {"port": port, "protocol": "tcp", "status": "filtered", "ms": None,
                "service": SERVICE_NAMES.get(port)}
    except OSError:
        return {"port": port, "protocol": "tcp", "status": "closed", "ms":
                round((time.perf_counter() - started) * 1000),
                "service": SERVICE_NAMES.get(port)}
    finally:
        sock.close()


def _check_udp(ip: str, port: int, timeout: float) -> dict:
    """Best-effort UDP probe. Timeout usually means open|filtered."""
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(b"", (ip, port))
        try:
            sock.recvfrom(1024)
            ms = round((time.perf_counter() - started) * 1000)
            return {"port": port, "protocol": "udp", "status": "open", "ms": ms,
                    "service": SERVICE_NAMES.get(port)}
        except socket.timeout:
            return {"port": port, "protocol": "udp", "status": "open|filtered", "ms": None,
                    "service": SERVICE_NAMES.get(port)}
    except ConnectionRefusedError:
        return {"port": port, "protocol": "udp", "status": "closed", "ms":
                round((time.perf_counter() - started) * 1000),
                "service": SERVICE_NAMES.get(port)}
    except OSError:
        return {"port": port, "protocol": "udp", "status": "closed", "ms":
                round((time.perf_counter() - started) * 1000),
                "service": SERVICE_NAMES.get(port)}
    finally:
        sock.close()


_HTTP_PROBE = b"HEAD / HTTP/1.0\r\nUser-Agent: DomainTools-PortScan\r\n\r\n"


def _recv(sock: socket.socket, wait: float) -> bytes:
    sock.settimeout(wait)
    try:
        return sock.recv(1024)
    except (socket.timeout, OSError):
        return b""


def _clean(data: bytes, limit: int = 160) -> str:
    text = data.decode("latin-1", errors="replace")
    text = "".join(c if c.isprintable() else " " for c in text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _identify(data: bytes) -> tuple[str | None, str | None]:
    """Return (service, version/banner) from the first bytes a server sent."""
    if not data:
        return None, None
    text = data.decode("latin-1", errors="replace")
    if text.startswith("HTTP/"):
        m = re.search(r"(?im)^server:\s*(.+)$", text)
        return "http", (m.group(1).strip()[:120] if m else None)
    if text.startswith("SSH-"):
        return "ssh", text.splitlines()[0][:120]
    if text.startswith("RFB "):
        return "vnc", text.splitlines()[0][:40]
    if text.startswith("+OK"):
        return "pop3", _clean(data)
    if text.startswith("* OK") or text.startswith("* PREAUTH"):
        return "imap", _clean(data)
    if text.startswith("220"):
        low = text.lower()
        if "smtp" in low or "esmtp" in low or "postfix" in low or "exim" in low:
            return "smtp", _clean(data)
        if "ftp" in low:
            return "ftp", _clean(data)
        return None, _clean(data)
    if text.startswith(("+PONG", "-NOAUTH", "-DENIED", "-ERR unknown command")):
        return "redis", None
    if len(data) > 5 and data[4] == 0x0A:
        version = data[5:].split(b"\x00", 1)[0].decode("latin-1", errors="replace")
        if re.match(r"^\d+\.\d+", version):
            return ("mariadb" if "mariadb" in version.lower() else "mysql"), version[:80]
    if data.startswith(b"\x15\x03") or data.startswith(b"\x16\x03"):
        return "tls", None
    if text.startswith("RTSP/"):
        return "rtsp", None
    return None, None


def _fingerprint_tcp(ip: str, host: str, port: int, timeout: float) -> dict:
    """Best-effort service identification on an already-open TCP port."""
    wait = max(0.5, min(timeout, 2.0))
    info: dict = {"detected_service": None, "banner": None, "tls": False}

    def connect() -> socket.socket | None:
        try:
            return socket.create_connection((ip, port), timeout=wait)
        except OSError:
            return None

    # 1) Passive: many services greet first (SSH, SMTP, FTP, MySQL...).
    sock = connect()
    if sock:
        try:
            data = _recv(sock, 0.6)
        finally:
            sock.close()
        service, banner = _identify(data)
        if service or banner:
            info.update(detected_service=service, banner=banner or _clean(data) or None)
            if service:
                return info

    # 2) TLS handshake (HTTPS, SMTPS, IMAPS...), then talk over the encrypted channel.
    sock = connect()
    if sock:
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with ctx.wrap_socket(sock, server_hostname=host if not host.replace(".", "").isdigit() else None) as tls:
                info["tls"] = True
                tls.sendall(_HTTP_PROBE)
                data = _recv(tls, wait)
                service, banner = _identify(data)
                if service == "http":
                    info.update(detected_service="https", banner=banner)
                elif service:
                    info.update(detected_service=f"{service}/tls", banner=banner)
                else:
                    info.update(detected_service="tls", banner=_clean(data) or info["banner"])
                return info
        except (ssl.SSLError, OSError):
            pass
        finally:
            sock.close()

    # 3) Plain probes: HTTP, then Redis PING.
    for probe in (_HTTP_PROBE, b"PING\r\n"):
        sock = connect()
        if not sock:
            break
        try:
            sock.sendall(probe)
            data = _recv(sock, wait)
        except OSError:
            data = b""
        finally:
            sock.close()
        service, banner = _identify(data)
        if service:
            info.update(detected_service=service, banner=banner)
            return info
        if data and not info["banner"]:
            info["banner"] = _clean(data) or None
    return info


def _prepare(
    host: str,
    protocol: str,
    mode: str,
    preset: str | None,
    ports: str | None,
    timeout: float,
    concurrency: int,
) -> tuple[list[int], float, int]:
    if protocol not in ("tcp", "udp", "both"):
        raise ValueError("Protocolo inválido (tcp, udp o both)")
    if mode not in ("quick", "manual"):
        raise ValueError("Modo inválido (quick o manual)")
    timeout = max(0.2, min(float(timeout), 5.0))
    concurrency = max(1, min(int(concurrency), 128))
    if mode == "quick":
        key = (preset or "common").strip().lower()
        if key not in PRESETS:
            raise ValueError(f"Preset desconocido: {key}")
        port_list = PRESETS[key]
    else:
        port_list = _parse_ports(ports or "")
    if len(port_list) > MAX_PORTS:
        raise ValueError(f"Máximo {MAX_PORTS} puertos por escaneo")
    return port_list, timeout, concurrency


async def stream_port_scan(
    host: str,
    *,
    protocol: Protocol = "tcp",
    mode: Literal["quick", "manual"] = "manual",
    preset: str | None = None,
    ports: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> tuple[dict, AsyncIterator[dict]]:
    """Validate and resolve eagerly (raises ValueError), then yield events as ports finish."""
    port_list, timeout, concurrency = _prepare(host, protocol, mode, preset, ports, timeout, concurrency)
    display_host, ip = await asyncio.to_thread(_resolve_host, host)
    protocols = [p for p in ("tcp", "udp") if protocol in (p, "both")]
    jobs = [(proto, p) for p in port_list for proto in protocols]
    start_event = {
        "type": "start", "host": display_host, "ip": ip, "protocol": protocol,
        "mode": mode, "total": len(jobs),
    }

    async def events() -> AsyncIterator[dict]:
        sem = asyncio.Semaphore(concurrency)
        started = time.perf_counter()

        async def _one(proto: str, port: int) -> dict:
            async with sem:
                if proto == "tcp":
                    res = await asyncio.to_thread(_check_tcp, ip, port, timeout)
                    if res["status"] == "open":
                        res.update(await asyncio.to_thread(_fingerprint_tcp, ip, display_host, port, timeout))
                    return res
                return await asyncio.to_thread(_check_udp, ip, port, timeout)

        tasks = [asyncio.create_task(_one(proto, port)) for proto, port in jobs]
        counts = {"open": 0, "filtered": 0, "closed": 0}
        done = 0
        try:
            for fut in asyncio.as_completed(tasks):
                res = await fut
                done += 1
                if res["status"] == "open":
                    counts["open"] += 1
                elif res["status"] in ("filtered", "open|filtered"):
                    counts["filtered"] += 1
                else:
                    counts["closed"] += 1
                yield {"type": "result", "result": res, "done": done, "total": len(jobs), **counts}
            yield {"type": "done", "total": len(jobs), "total_ms": round((time.perf_counter() - started) * 1000), **counts}
        finally:
            for t in tasks:
                t.cancel()

    return start_event, events()


async def check_ports(
    host: str,
    *,
    protocol: Protocol = "tcp",
    mode: Literal["quick", "manual"] = "manual",
    preset: str | None = None,
    ports: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> dict:
    if protocol not in ("tcp", "udp", "both"):
        raise ValueError("Protocolo inválido (tcp, udp o both)")
    if mode not in ("quick", "manual"):
        raise ValueError("Modo inválido (quick o manual)")

    timeout = max(0.2, min(float(timeout), 5.0))
    concurrency = max(1, min(int(concurrency), 128))

    if mode == "quick":
        key = (preset or "common").strip().lower()
        if key not in PRESETS:
            raise ValueError(f"Preset desconocido: {key}")
        port_list = PRESETS[key]
    else:
        port_list = _parse_ports(ports or "")

    if len(port_list) > MAX_PORTS:
        raise ValueError(f"Máximo {MAX_PORTS} puertos por escaneo")

    display_host, ip = await asyncio.to_thread(_resolve_host, host)

    protocols: list[str] = []
    if protocol in ("tcp", "both"):
        protocols.append("tcp")
    if protocol in ("udp", "both"):
        protocols.append("udp")

    jobs: list[tuple[str, int]] = [(proto, p) for p in port_list for proto in protocols]
    sem = asyncio.Semaphore(concurrency)
    started = time.perf_counter()

    async def _one(proto: str, port: int) -> dict:
        async with sem:
            checker = _check_tcp if proto == "tcp" else _check_udp
            return await asyncio.to_thread(checker, ip, port, timeout)

    results = await asyncio.gather(*[_one(proto, port) for proto, port in jobs])
    results_sorted = sorted(results, key=lambda r: (r["port"], r["protocol"]))

    open_count = sum(1 for r in results_sorted if r["status"] == "open")
    filtered_count = sum(1 for r in results_sorted if r["status"] in ("filtered", "open|filtered"))
    closed_count = sum(1 for r in results_sorted if r["status"] == "closed")

    return {
        "host": display_host,
        "ip": ip,
        "protocol": protocol,
        "mode": mode,
        "preset": preset if mode == "quick" else None,
        "ports_requested": port_list,
        "total": len(results_sorted),
        "open": open_count,
        "filtered": filtered_count,
        "closed": closed_count,
        "total_ms": round((time.perf_counter() - started) * 1000),
        "results": results_sorted,
    }
