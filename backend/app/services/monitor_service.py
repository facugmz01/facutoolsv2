from __future__ import annotations

import asyncio
import math
import socket
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonitorCheckResult, MonitorIncident, MonitorLog, MonitorTarget
from app.services.verification_checks import (
    check_http_keyword,
    check_ping,
    check_soap,
    check_ssl,
    check_tcp_port,
    check_whois_expiration,
    check_wordpress,
)

CHECK_TYPES = ("http", "ping", "tcp", "dns", "ssl", "tcp_port", "http_keyword", "soap", "wordpress", "whois")
DEFAULT_TIMEOUT = 10.0
MIN_INTERVAL_SECONDS = 5


async def _check_http(target: str) -> dict:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(target)
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return {
                "is_up": response.status_code < 500,
                "status_code": response.status_code,
                "response_time_ms": elapsed,
                "error_message": None,
            }
    except Exception as exc:
        return {"is_up": False, "status_code": None, "response_time_ms": None, "error_message": str(exc)[:500]}


def _check_tcp_sync(host: str, port: int, timeout: float) -> dict:
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((host, port))
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        return {"is_up": True, "status_code": None, "response_time_ms": elapsed, "error_message": None}
    except Exception as exc:
        return {"is_up": False, "status_code": None, "response_time_ms": None, "error_message": str(exc)[:500]}
    finally:
        sock.close()


async def _check_tcp(target: str, port: Optional[int]) -> dict:
    if not port:
        return {"is_up": False, "status_code": None, "response_time_ms": None, "error_message": "Falta el puerto"}
    return await asyncio.to_thread(_check_tcp_sync, target, port, DEFAULT_TIMEOUT)


def _check_dns_sync(host: str) -> dict:
    started = time.perf_counter()
    try:
        socket.getaddrinfo(host, None)
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        return {"is_up": True, "status_code": None, "response_time_ms": elapsed, "error_message": None}
    except Exception as exc:
        return {"is_up": False, "status_code": None, "response_time_ms": None, "error_message": str(exc)[:500]}


async def _check_dns(target: str) -> dict:
    return await asyncio.to_thread(_check_dns_sync, target)


async def perform_check(target: MonitorTarget) -> dict:
    if target.check_type == "ssl":
        result = await check_ssl(target.target, target.port or 443)
        return _to_check_result(result)
    if target.check_type == "tcp_port":
        if not target.port:
            return _to_check_result(_configuration_error("El chequeo tcp_port requiere un puerto"))
        result = await check_tcp_port(target.target, target.port)
        return _to_check_result(result)
    if target.check_type == "ping":
        return _to_check_result(await check_ping(target.target))
    if target.check_type == "http_keyword":
        if not target.keyword:
            return _to_check_result(_configuration_error("El chequeo http_keyword requiere un keyword"))
        result = await check_http_keyword(target.target, target.keyword)
        return _to_check_result(result)
    if target.check_type == "soap":
        if not target.soap_action or not target.request_body:
            return _to_check_result(_configuration_error("El chequeo soap requiere SOAPAction y XML"))
        result = await check_soap(target.target, target.soap_action, target.request_body)
        return _to_check_result(result)
    if target.check_type == "wordpress":
        return _to_check_result(await check_wordpress(target.target))
    if target.check_type == "whois":
        result = await check_whois_expiration(target.target)
        return _to_check_result(result)
    if target.check_type == "http":
        return await _check_http(target.target)
    if target.check_type == "tcp":
        return await _check_tcp(target.target, target.port)
    if target.check_type == "dns":
        return await _check_dns(target.target)
    return {"is_up": False, "status_code": None, "response_time_ms": None, "error_message": f"Tipo de chequeo inválido: {target.check_type}"}


def _configuration_error(message: str) -> dict:
    return {"status": "DOWN", "latency_ms": 0.0, "details": {}, "error_message": message}


def _to_check_result(result: dict) -> dict:
    """Adapt the public checker contract to the legacy database result shape."""
    return {
        "is_up": result["status"] != "DOWN",
        "status_code": result["details"].get("status_code"),
        "response_time_ms": result["latency_ms"],
        "error_message": result["error_message"],
        "monitor_status": "DEGRADED" if result["status"] == "WARNING" else result["status"],
    }


def _legacy_monitor_status(result: dict) -> str:
    return result.pop("monitor_status", "UP" if result.get("is_up") else "DOWN")


def add_monitor_log(db: AsyncSession, target_id: int, result: dict) -> MonitorLog:
    log = MonitorLog(
        monitor_id=target_id,
        status=_legacy_monitor_status(result),
        response_time_ms=result.get("response_time_ms"),
        status_code=result.get("status_code"),
        error_detail=result.get("error_message"),
    )
    db.add(log)
    return log


def _validated_interval_seconds(interval_seconds: Optional[int], interval_minutes: int | None) -> int:
    seconds = interval_seconds if interval_seconds is not None else (interval_minutes or 0) * 60
    if seconds < MIN_INTERVAL_SECONDS:
        raise ValueError(f"La frecuencia mínima es de {MIN_INTERVAL_SECONDS} segundos")
    return seconds


def _validate_thresholds(warning_threshold_ms: int | None, critical_threshold_ms: int | None) -> None:
    if warning_threshold_ms is not None and warning_threshold_ms < 0:
        raise ValueError("El umbral de advertencia no puede ser negativo")
    if critical_threshold_ms is not None and critical_threshold_ms < 0:
        raise ValueError("El umbral crítico no puede ser negativo")
    if (
        warning_threshold_ms is not None
        and critical_threshold_ms is not None
        and warning_threshold_ms > critical_threshold_ms
    ):
        raise ValueError("El umbral de advertencia debe ser menor o igual al crítico")


async def sync_incident_state(db: AsyncSession, target: MonitorTarget, is_up: bool) -> MonitorIncident | None:
    """Open an incident on a down transition, resolve the open one on recovery. No-op if state didn't change."""
    result = await db.execute(
        select(MonitorIncident)
        .where(MonitorIncident.target_id == target.id, MonitorIncident.status == "open")
        .order_by(MonitorIncident.started_at.desc())
        .limit(1)
    )
    open_incident = result.scalar_one_or_none()
    if is_up:
        if open_incident:
            open_incident.status = "resolved"
            open_incident.resolved_at = datetime.utcnow()
        return open_incident
    if open_incident:
        return open_incident
    incident = MonitorIncident(target_id=target.id)
    db.add(incident)
    return incident


class MonitoringService:
    def __init__(self, db: AsyncSession, organization_id: int | None = None):
        self.db = db
        self.organization_id = organization_id

    def _org_filter(self, query):
        if self.organization_id is not None:
            return query.where(MonitorTarget.organization_id == self.organization_id)
        return query

    async def list_targets(self) -> list[MonitorTarget]:
        q = self._org_filter(select(MonitorTarget)).order_by(MonitorTarget.name)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_target(self, target_id: int) -> MonitorTarget | None:
        q = self._org_filter(select(MonitorTarget)).where(MonitorTarget.id == target_id)
        result = await self.db.execute(q)
        return result.scalar_one_or_none()

    async def create_target(self, data) -> MonitorTarget:
        if data.check_type not in CHECK_TYPES:
            raise ValueError(f"Tipo de chequeo inválido: {data.check_type}")
        if data.check_type == "tcp" and not data.port:
            raise ValueError("El chequeo tcp requiere un puerto")
        if data.check_type == "tcp_port" and not data.port:
            raise ValueError("El chequeo tcp_port requiere un puerto")
        if data.check_type == "http_keyword" and not data.keyword:
            raise ValueError("El chequeo http_keyword requiere un keyword")
        if data.check_type == "soap" and (not data.soap_action or not data.request_body):
            raise ValueError("El chequeo soap requiere SOAPAction y XML")
        interval_seconds = _validated_interval_seconds(data.interval_seconds, data.interval_minutes)
        _validate_thresholds(data.warning_threshold_ms, data.critical_threshold_ms)
        target = MonitorTarget(
            organization_id=self.organization_id,
            name=data.name.strip(),
            check_type=data.check_type,
            target=data.target.strip(),
            port=data.port,
            keyword=data.keyword.strip() if data.keyword else None,
            soap_action=data.soap_action.strip() if data.soap_action else None,
            request_body=data.request_body,
            interval_minutes=max(1, math.ceil(interval_seconds / 60)),
            interval_seconds=interval_seconds,
            warning_threshold_ms=data.warning_threshold_ms,
            critical_threshold_ms=data.critical_threshold_ms,
            is_active=data.is_active,
            is_public=data.is_public,
        )
        self.db.add(target)
        await self.db.commit()
        await self.db.refresh(target)
        return target

    async def update_target(self, target_id: int, data) -> MonitorTarget | None:
        target = await self.get_target(target_id)
        if not target:
            return None
        updates = data.dict(exclude_unset=True)
        if "check_type" in updates and updates["check_type"] not in CHECK_TYPES:
            raise ValueError(f"Tipo de chequeo inválido: {updates['check_type']}")
        next_type = updates.get("check_type", target.check_type)
        next_port = updates.get("port", target.port)
        next_keyword = updates.get("keyword", target.keyword)
        next_soap_action = updates.get("soap_action", target.soap_action)
        next_request_body = updates.get("request_body", target.request_body)
        if next_type in ("tcp", "tcp_port", "ssl") and not next_port:
            raise ValueError(f"El chequeo {next_type} requiere un puerto")
        if next_type == "http_keyword" and not next_keyword:
            raise ValueError("El chequeo http_keyword requiere un keyword")
        if next_type == "soap" and (not next_soap_action or not next_request_body):
            raise ValueError("El chequeo soap requiere SOAPAction y XML")
        if "interval_seconds" in updates or "interval_minutes" in updates:
            interval_seconds = _validated_interval_seconds(
                updates.get("interval_seconds"),
                updates.get("interval_minutes", target.interval_minutes),
            )
            updates["interval_seconds"] = interval_seconds
            updates["interval_minutes"] = max(1, math.ceil(interval_seconds / 60))
        _validate_thresholds(
            updates.get("warning_threshold_ms", target.warning_threshold_ms),
            updates.get("critical_threshold_ms", target.critical_threshold_ms),
        )
        for field, value in updates.items():
            if field in ("keyword", "soap_action") and value:
                value = value.strip()
            setattr(target, field, value)
        await self.db.commit()
        await self.db.refresh(target)
        return target

    async def delete_target(self, target_id: int) -> bool:
        target = await self.get_target(target_id)
        if not target:
            return False
        await self.db.delete(target)
        await self.db.commit()
        return True

    async def run_check_now(self, target_id: int) -> MonitorCheckResult | None:
        target = await self.get_target(target_id)
        if not target:
            return None
        result = await perform_check(target)
        add_monitor_log(self.db, target.id, result)
        check = MonitorCheckResult(target_id=target.id, **result)
        self.db.add(check)
        await sync_incident_state(self.db, target, result["is_up"])
        await self.db.commit()
        await self.db.refresh(check)
        return check

    async def history(self, target_id: int, days: int = 7) -> dict | None:
        target = await self.get_target(target_id)
        if not target:
            return None
        since = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self.db.execute(
            select(MonitorLog)
            .where(MonitorLog.monitor_id == target_id, MonitorLog.created_at >= since)
            .order_by(MonitorLog.created_at.asc())
        )
        logs = list(result.scalars().all())
        total = len(logs)
        uptime = (sum(1 for log in logs if log.status == "UP") / total * 100) if total else None
        latencies = [log.response_time_ms for log in logs if log.response_time_ms is not None]
        average_latency = sum(latencies) / len(latencies) if latencies else None
        return {
            "monitor_id": target_id,
            "days": days,
            "uptime_percent": round(uptime, 2) if uptime is not None else None,
            "average_latency_ms": round(average_latency, 2) if average_latency is not None else None,
            "logs": logs,
        }

    async def list_results(self, target_id: int, limit: int = 100) -> list[MonitorCheckResult]:
        result = await self.db.execute(
            select(MonitorCheckResult)
            .where(MonitorCheckResult.target_id == target_id)
            .order_by(MonitorCheckResult.checked_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_incidents(self, target_id: int, limit: int = 50) -> list[MonitorIncident]:
        result = await self.db.execute(
            select(MonitorIncident)
            .where(MonitorIncident.target_id == target_id)
            .order_by(MonitorIncident.started_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def uptime_stats(self, target_id: int, hours: int = 24) -> dict:
        since = datetime.utcnow() - timedelta(hours=hours)
        result = await self.db.execute(
            select(MonitorCheckResult)
            .where(MonitorCheckResult.target_id == target_id, MonitorCheckResult.checked_at >= since)
            .order_by(MonitorCheckResult.checked_at.asc())
        )
        checks = list(result.scalars().all())
        total = len(checks)
        up = sum(1 for c in checks if c.is_up)
        avg_response_ms = None
        response_times = [c.response_time_ms for c in checks if c.response_time_ms is not None]
        if response_times:
            avg_response_ms = round(sum(response_times) / len(response_times), 2)
        return {
            "window_hours": hours,
            "total_checks": total,
            "uptime_percent": round((up / total) * 100, 2) if total else None,
            "avg_response_time_ms": avg_response_ms,
            "last_check": checks[-1].checked_at if checks else None,
            "currently_up": checks[-1].is_up if checks else None,
        }
