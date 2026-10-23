from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models import AlertRule, Domain, MonitorCheckResult, MonitorLog, MonitorTarget, SSLCertificate
from app.services.domain_service import DomainService
from app.services.monitor_service import add_monitor_log, perform_check, sync_incident_state
from app.services.notifications import create_alert
from app.services.ssl_service import SSLService
from app.settings_store import SettingsStore

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

MIN_INTERVAL_MINUTES = 1
RULE_OPERATORS = {"lt", "lte", "eq", "gte", "gt", "ne", "in", "contains", "is_true", "is_false"}
RULE_DEFAULT_FIELDS = {
    "expiry": "days_until_expiry",
    "renewal": "days_until_expiry",
    "downtime": "health.is_up",
    "response_time": "health.response_time_ms",
    "status_code": "health.status_code",
    "ssl_expiry": "ssl.days_remaining",
}


def _interval_minutes(key: str, default: int) -> int:
    return max(MIN_INTERVAL_MINUTES, SettingsStore.get_int(key, default))


def _job_next_run_iso(job_id: str) -> Optional[str]:
    job = scheduler.get_job(job_id)
    if not job or not job.next_run_time:
        return None
    next_run = job.next_run_time
    if next_run.tzinfo is None:
        next_run = next_run.replace(tzinfo=timezone.utc)
    return next_run.astimezone(timezone.utc).isoformat()


async def monitor_all_domains():
    logger.info("Running scheduled domain monitoring...")
    async with async_session() as db:
        result = await db.execute(select(Domain))
        domains = result.scalars().all()
        service = DomainService(db)
        for domain in domains:
            try:
                await service.scan_and_update(domain.id)
                logger.info(f"Scanned {domain.name}")
            except Exception as e:
                logger.error(f"Failed to scan {domain.name}: {e}")


async def monitor_all_ssl():
    logger.info("Running scheduled SSL monitoring...")
    async with async_session() as db:
        ssl_service = SSLService(db)
        try:
            result = await ssl_service.monitor_all()
            logger.info(f"SSL monitoring complete: {result}")
            renew = await ssl_service.renew_expiring()
            if renew["renewal_requests"] > 0:
                logger.info(f"Auto-renewal triggered for {renew['renewal_requests']} certificates")
        except Exception as e:
            logger.error(f"SSL monitoring failed: {e}")


async def monitor_own_systems():
    """Tick job: runs each active MonitorTarget whose own interval_minutes has elapsed."""
    logger.info("Running scheduled own-systems monitoring...")
    async with async_session() as db:
        result = await db.execute(select(MonitorTarget).where(MonitorTarget.is_active.is_(True)))
        targets = result.scalars().all()
        now = datetime.utcnow()
        for target in targets:
            last_result = await db.execute(
                select(MonitorCheckResult)
                .where(MonitorCheckResult.target_id == target.id)
                .order_by(MonitorCheckResult.checked_at.desc())
                .limit(1)
            )
            last = last_result.scalar_one_or_none()
            interval_seconds = target.interval_seconds or target.interval_minutes * 60
            if last and now - last.checked_at < timedelta(seconds=interval_seconds):
                continue
            try:
                outcome = await perform_check(target)
            except Exception as e:
                logger.error(f"Failed to check monitor target {target.name}: {e}")
                continue
            add_monitor_log(db, target.id, outcome)
            db.add(MonitorCheckResult(target_id=target.id, **outcome))
            if last is not None and last.is_up != outcome["is_up"]:
                is_up = outcome["is_up"]
                await sync_incident_state(db, target, is_up)
                await create_alert(
                    db,
                    organization_id=target.organization_id,
                    domain_id=None,
                    alert_type="monitor_status_change",
                    severity="info" if is_up else "critical",
                    title=f"{target.name} is back up" if is_up else f"{target.name} is down",
                    message=outcome.get("error_message")
                    or f"{target.name} ({target.target}) is now {'up' if is_up else 'down'}",
                    domain_name=target.name,
                )
            elif last is None and not outcome["is_up"]:
                # First check ever and already down: open an incident, but don't spam an alert for baseline state.
                await sync_incident_state(db, target, outcome["is_up"])
        await db.commit()
    logger.info("Own-systems monitoring complete")


async def cleanup_monitor_logs():
    """Delete monitor history older than the seven-day retention window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    async with async_session() as db:
        result = await db.execute(delete(MonitorLog).where(MonitorLog.created_at < cutoff))
        await db.commit()
        logger.info("Monitor log retention removed %s records", result.rowcount or 0)


def _rule_value(domain: Domain, health, certificate: SSLCertificate | None, field: str):
    if field == "days_until_expiry":
        return (domain.expires_at - datetime.utcnow()).days if domain.expires_at else None
    if hasattr(domain, field):
        return getattr(domain, field)
    if field.startswith("health."):
        return getattr(health, field[7:], None) if health else None
    if field.startswith("ssl."):
        return getattr(certificate, field[4:], None) if certificate else None
    return None


def _condition_matches(value, condition: dict) -> bool:
    operator = condition.get("operator", "eq")
    expected = condition.get("value")
    if value is None:
        return False
    if operator == "is_true":
        return value is True
    if operator == "is_false":
        return value is False
    if operator == "contains":
        return expected in value
    if operator == "in":
        return value in expected
    if operator == "eq":
        return value == expected
    if operator == "ne":
        return value != expected
    if operator == "lt":
        return value < expected
    if operator == "lte":
        return value <= expected
    if operator == "gte":
        return value >= expected
    if operator == "gt":
        return value > expected
    return False


def _rule_alert_details(rule: AlertRule, domain: Domain, condition: dict) -> tuple[str, str, str]:
    severity = condition.get("severity", "warning")
    title = condition.get("title") or f"Alert rule matched: {rule.name}"
    message = condition.get("message") or (
        f"Rule '{rule.name}' matched for {domain.name}: "
        f"{condition.get('field')} {condition.get('operator', 'eq')} {condition.get('value')}"
    )
    return severity, title, message


async def evaluate_alert_rules():
    """Evaluate active custom rules against the latest domain health and SSL data."""
    logger.info("Evaluating custom alert rules...")
    triggered = 0
    async with async_session() as db:
        rules = (
            await db.execute(select(AlertRule).where(AlertRule.is_active.is_(True)))
        ).scalars().all()
        domains = (
            await db.execute(select(Domain).options(selectinload(Domain.health_checks)))
        ).scalars().all()
        certificates = (
            await db.execute(
                select(SSLCertificate)
                .where(SSLCertificate.domain_id.is_not(None))
                .order_by(SSLCertificate.updated_at.desc())
            )
        ).scalars().all()
        latest_certificates = {}
        for certificate in certificates:
            latest_certificates.setdefault(certificate.domain_id, certificate)

        for rule in rules:
            condition = rule.condition if isinstance(rule.condition, dict) else {}
            field = condition.get("field") or RULE_DEFAULT_FIELDS.get(rule.rule_type)
            operator = condition.get("operator", "eq")
            if not field or operator not in RULE_OPERATORS:
                logger.warning("Skipping invalid alert rule id=%s", rule.id)
                continue

            for domain in domains:
                if domain.organization_id != rule.organization_id:
                    continue
                health = max(domain.health_checks, key=lambda item: item.checked_at, default=None)
                certificate = latest_certificates.get(domain.id)
                value = _rule_value(domain, health, certificate, field)
                try:
                    matches = _condition_matches(value, condition)
                except (TypeError, ValueError):
                    logger.warning("Invalid value in alert rule id=%s", rule.id)
                    matches = False
                if not matches:
                    continue

                severity, title, message = _rule_alert_details(rule, domain, condition)
                alert = await create_alert(
                    db,
                    organization_id=rule.organization_id,
                    domain_id=domain.id,
                    alert_type=f"custom_rule:{rule.id}",
                    severity=severity,
                    title=title,
                    message=message,
                    domain_name=domain.name,
                    channels=rule.channels or None,
                )
                if alert:
                    triggered += 1
        await db.commit()
    logger.info("Custom alert rules evaluated: %s alerts triggered", triggered)


def reschedule_jobs():
    domain_minutes = _interval_minutes("monitor_interval_minutes", 30)
    ssl_minutes = _interval_minutes("ssl_monitor_interval_minutes", 60)
    alert_minutes = _interval_minutes("alert_rule_interval_minutes", 5)
    own_systems_minutes = _interval_minutes("monitor_own_systems_interval_minutes", 5)

    domain_had_job = scheduler.get_job("domain_monitor") is not None
    ssl_had_job = scheduler.get_job("ssl_monitor") is not None
    own_systems_had_job = scheduler.get_job("own_systems_monitor") is not None

    for job_id in (
        "domain_monitor",
        "ssl_monitor",
        "alert_rule_monitor",
        "own_systems_monitor",
        "monitor_log_retention",
    ):
        try:
            scheduler.remove_job(job_id)
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    # First boot: run soon. On settings change: wait for the new interval.
    domain_next = now if not domain_had_job else now + timedelta(minutes=domain_minutes)
    ssl_next = now if not ssl_had_job else now + timedelta(minutes=ssl_minutes)
    own_systems_next = now if not own_systems_had_job else now + timedelta(minutes=own_systems_minutes)

    scheduler.add_job(
        monitor_all_domains,
        "interval",
        minutes=domain_minutes,
        id="domain_monitor",
        replace_existing=True,
        next_run_time=domain_next,
    )
    scheduler.add_job(
        monitor_all_ssl,
        "interval",
        minutes=ssl_minutes,
        id="ssl_monitor",
        replace_existing=True,
        next_run_time=ssl_next,
    )
    scheduler.add_job(
        evaluate_alert_rules,
        "interval",
        minutes=alert_minutes,
        id="alert_rule_monitor",
        replace_existing=True,
    )
    scheduler.add_job(
        monitor_own_systems,
        "interval",
        minutes=own_systems_minutes,
        id="own_systems_monitor",
        replace_existing=True,
        next_run_time=own_systems_next,
    )
    scheduler.add_job(
        cleanup_monitor_logs,
        "cron",
        hour=0,
        minute=0,
        timezone=timezone.utc,
        id="monitor_log_retention",
        replace_existing=True,
    )
    logger.info(
        f"Scheduler rescheduled (domain: {domain_minutes}min, ssl: {ssl_minutes}min, "
        f"alert rules: {alert_minutes}min, own systems: {own_systems_minutes}min)"
    )


def get_schedule_status() -> Dict[str, Any]:
    domain_minutes = _interval_minutes("monitor_interval_minutes", 30)
    ssl_minutes = _interval_minutes("ssl_monitor_interval_minutes", 60)
    alert_minutes = _interval_minutes("alert_rule_interval_minutes", 5)
    own_systems_minutes = _interval_minutes("monitor_own_systems_interval_minutes", 5)
    return {
        "running": scheduler.running,
        "domain_monitor": {
            "interval_minutes": domain_minutes,
            "next_run_at": _job_next_run_iso("domain_monitor"),
        },
        "ssl_monitor": {
            "interval_minutes": ssl_minutes,
            "next_run_at": _job_next_run_iso("ssl_monitor"),
        },
        "alert_rule_monitor": {
            "interval_minutes": alert_minutes,
            "next_run_at": _job_next_run_iso("alert_rule_monitor"),
        },
        "own_systems_monitor": {
            "interval_minutes": own_systems_minutes,
            "next_run_at": _job_next_run_iso("own_systems_monitor"),
        },
    }


def get_next_domain_scan_at() -> Optional[str]:
    return _job_next_run_iso("domain_monitor")


def start_scheduler():
    if not scheduler.running:
        scheduler.start()
    reschedule_jobs()
    logger.info("Scheduler started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
