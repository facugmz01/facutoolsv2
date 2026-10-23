from __future__ import annotations

import asyncio
import base64
import re
import socket
import ssl
from datetime import datetime

from app.services.notifications.providers.smtp_email import send_smtp_email


def _add_log(log: list, log_type: str, msg: str) -> None:
    log.append({"type": log_type, "msg": msg.strip(), "time": datetime.now().strftime("%H:%M:%S")})


def _read_response(conn, log: list, expected: str | None = None) -> str:
    res = ""
    while True:
        chunk = conn.recv(512).decode("utf-8", errors="replace")
        if not chunk:
            break
        res += chunk
        lines = res.split("\r\n")
        for line in lines:
            if line:
                _add_log(log, "rx", line)
        if len(res) >= 4 and res[3] == " ":
            break
    if expected and not res.startswith(expected):
        raise RuntimeError(f"Se esperaba código {expected}, se recibió: {res[:3]}")
    return res


def _send_command(conn, log: list, cmd: str, mask: bool = False) -> None:
    display = "********" if mask else cmd
    _add_log(log, "tx", display)
    conn.sendall((cmd + "\r\n").encode())


def _smtp_test_sync(
    host: str, port: int, user: str, password: str,
    mail_from: str, rcpt_to: str, security: str,
) -> dict:
    log: list[dict] = []
    conn = None
    try:
        use_ssl = security == "ssl" or port == 465
        protocol = "ssl://" if use_ssl else ""
        _add_log(log, "info", f"Conectando a {protocol}{host}:{port}...")

        if use_ssl:
            context = ssl.create_default_context()
            raw = socket.create_connection((host, port), timeout=10)
            conn = context.wrap_socket(raw, server_hostname=host)
        else:
            conn = socket.create_connection((host, port), timeout=10)

        conn.settimeout(10)
        _read_response(conn, log, "220")

        helo = "localhost"
        _send_command(conn, log, f"EHLO {helo}")
        ehlo_res = _read_response(conn, log, "250")

        if (security in ("tls", "auto")) and port != 465 and "STARTTLS" in ehlo_res.upper():
            _send_command(conn, log, "STARTTLS")
            _read_response(conn, log, "220")
            context = ssl.create_default_context()
            conn = context.wrap_socket(conn, server_hostname=host)
            _add_log(log, "info", "Túnel TLS establecido correctamente")
            _send_command(conn, log, f"EHLO {helo}")
            _read_response(conn, log, "250")

        if user and password:
            _send_command(conn, log, "AUTH LOGIN")
            _read_response(conn, log, "334")
            _send_command(conn, log, base64.b64encode(user.encode()).decode())
            _read_response(conn, log, "334")
            _send_command(conn, log, base64.b64encode(password.encode()).decode(), mask=True)
            _read_response(conn, log, "235")
            _add_log(log, "info", f"Autenticación exitosa para {user}")

        if mail_from:
            _send_command(conn, log, f"MAIL FROM:<{mail_from}>")
            _read_response(conn, log, "250")
        if rcpt_to:
            _send_command(conn, log, f"RCPT TO:<{rcpt_to}>")
            _read_response(conn, log, "250")

        _send_command(conn, log, "QUIT")
        conn.close()
        return {"success": True, "log": log}
    except Exception as e:
        _add_log(log, "error", str(e))
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return {"success": False, "error": str(e), "log": log}


async def test_smtp(
    host: str, port: int, user: str = "", password: str = "",
    mail_from: str = "", rcpt_to: str = "", security: str = "auto",
    send_message: bool = False,
    subject: str = "DomainTools SMTP test",
    body: str = "This is a test message from the DomainTools SMTP tester.",
) -> dict:
    if not host or not port:
        raise ValueError("El servidor y el puerto son requeridos")
    if not re.match(r"^[a-zA-Z0-9.\-]+$", host):
        raise ValueError("Servidor SMTP inválido")

    result = await asyncio.to_thread(
        _smtp_test_sync, host, port, user, password, mail_from, rcpt_to, security
    )
    if not send_message or not result.get("success"):
        return result

    if not mail_from or not rcpt_to:
        result["success"] = False
        result["error"] = "Mail FROM y RCPT TO son requeridos para enviar un mensaje de prueba"
        result["log"].append({
            "type": "error",
            "msg": result["error"],
            "time": datetime.now().strftime("%H:%M:%S"),
        })
        return result

    delivery = await send_smtp_email(
        to_addrs=[rcpt_to],
        subject=subject,
        html_body=f"<p>{body}</p>",
        text_body=body,
        host=host,
        port=port,
        user=user,
        password=password,
        mail_from=mail_from,
        security=security,
    )
    result["sent"] = delivery.success
    result["send_detail"] = delivery.detail
    if delivery.success:
        result["log"].append({
            "type": "info",
            "msg": f"Mensaje de prueba enviado: {delivery.detail}",
            "time": datetime.now().strftime("%H:%M:%S"),
        })
    else:
        result["success"] = False
        result["error"] = delivery.detail
        result["log"].append({
            "type": "error",
            "msg": f"Fallo al enviar mensaje: {delivery.detail}",
            "time": datetime.now().strftime("%H:%M:%S"),
        })
    return result
