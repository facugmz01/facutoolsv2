from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    hashed_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Legacy column kept for DBs created before RBAC (NOT NULL without default).
    # Authorization uses Membership → Role → Permission, not this field.
    role: Mapped[str] = mapped_column(String(50), default="admin", server_default="admin")
    password_set: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    domains: Mapped[List["Domain"]] = relationship(back_populates="owner")
    memberships: Mapped[List["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    refresh_tokens: Mapped[List["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    memberships: Mapped[List["Membership"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    roles: Mapped[List["Role"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    domains: Mapped[List["Domain"]] = relationship(back_populates="organization")
    identity_providers: Mapped[List["IdentityProvider"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    invitations: Mapped[List["Invitation"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255), default="")

    role_permissions: Mapped[List["RolePermission"]] = relationship(back_populates="permission")


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_role_org_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="roles")
    role_permissions: Mapped[List["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )
    memberships: Mapped[List["Membership"]] = relationship(back_populates="role")


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), index=True)
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id"), index=True)

    role: Mapped["Role"] = relationship(back_populates="role_permissions")
    permission: Mapped["Permission"] = relationship(back_populates="role_permissions")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id", name="uq_membership_user_org"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | invited
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")
    role: Mapped["Role"] = relationship(back_populates="memberships")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class IdentityProvider(Base):
    __tablename__ = "identity_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    type: Mapped[str] = mapped_column(String(50), default="oidc")
    name: Mapped[str] = mapped_column(String(255))
    client_id: Mapped[str] = mapped_column(String(255))
    client_secret_enc: Mapped[str] = mapped_column(Text)
    issuer_url: Mapped[str] = mapped_column(String(500))
    scopes: Mapped[str] = mapped_column(String(255), default="openid email profile")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_provision: Mapped[bool] = mapped_column(Boolean, default=False)
    default_role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="identity_providers")
    default_role: Mapped[Optional["Role"]] = relationship()


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="invitations")
    role: Mapped["Role"] = relationship()


class Domain(Base):
    __tablename__ = "domains"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_domain_org_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    registrar: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    purchase_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    renewal_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    estimated_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    monitor_method: Mapped[str] = mapped_column(String(20), default="http", server_default="http")
    monitor_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization: Mapped[Optional["Organization"]] = relationship(back_populates="domains")
    owner: Mapped[Optional["User"]] = relationship(back_populates="domains")
    snapshots: Mapped[List["DomainSnapshot"]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    alerts: Mapped[List["Alert"]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    health_checks: Mapped[List["HealthCheck"]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    subdomains: Mapped[List["Subdomain"]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    ssl_certificates: Mapped[List["SSLCertificate"]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    notification_preferences: Mapped[Optional["DomainNotificationPreference"]] = relationship(
        back_populates="domain", cascade="all, delete-orphan", uselist=False,
    )


class DomainSnapshot(Base):
    __tablename__ = "domain_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id"))
    snapshot_type: Mapped[str] = mapped_column(String(50))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    domain: Mapped["Domain"] = relationship(back_populates="snapshots")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    domain_id: Mapped[Optional[int]] = mapped_column(ForeignKey("domains.id"), nullable=True)
    alert_type: Mapped[str] = mapped_column(String(100))
    severity: Mapped[str] = mapped_column(String(20), default="info")
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(50), default="in_app")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    domain: Mapped[Optional["Domain"]] = relationship(back_populates="alerts")


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id"))
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_up: Mapped[bool] = mapped_column(Boolean, default=True)
    ssl_valid: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ssl_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    domain: Mapped["Domain"] = relationship(back_populates="health_checks")


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    rule_type: Mapped[str] = mapped_column(String(100))
    condition: Mapped[dict] = mapped_column(JSON)
    channels: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DomainNotificationPreference(Base):
    __tablename__ = "domain_notification_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id"), unique=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    include_subdomains: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    domain: Mapped["Domain"] = relationship(back_populates="notification_preferences")


class WatchlistItem(Base):
    __tablename__ = "watchlist"
    __table_args__ = (UniqueConstraint("organization_id", "domain_name", name="uq_watchlist_org_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    domain_name: Mapped[str] = mapped_column(String(255), index=True)
    target_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_available: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MonitorTarget(Base):
    """A self-owned host/service to keep an uptime history for (internal monitoring, not a registered Domain)."""

    __tablename__ = "monitor_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    check_type: Mapped[str] = mapped_column(String(20), default="http")
    target: Mapped[str] = mapped_column(String(500))  # URL for http, host for tcp/dns
    port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # required for tcp
    keyword: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    soap_action: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    request_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=5)
    interval_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    warning_threshold_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    critical_threshold_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    checks: Mapped[List["MonitorCheckResult"]] = relationship(
        back_populates="target", cascade="all, delete-orphan", order_by="MonitorCheckResult.checked_at.desc()"
    )
    incidents: Mapped[List["MonitorIncident"]] = relationship(
        back_populates="target", cascade="all, delete-orphan", order_by="MonitorIncident.started_at.desc()"
    )
    logs: Mapped[List["MonitorLog"]] = relationship(
        back_populates="target", cascade="all, delete-orphan", order_by="MonitorLog.created_at.asc()"
    )


class MonitorLog(Base):
    __tablename__ = "monitor_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    monitor_id: Mapped[int] = mapped_column(
        ForeignKey("monitor_targets.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20))  # UP | DOWN | DEGRADED
    response_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_detail: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    target: Mapped["MonitorTarget"] = relationship(back_populates="logs")


class MonitorCheckResult(Base):
    __tablename__ = "monitor_check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("monitor_targets.id"), index=True)
    is_up: Mapped[bool] = mapped_column(Boolean, default=True)
    response_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    target: Mapped["MonitorTarget"] = relationship(back_populates="checks")


class MonitorIncident(Base):
    """A span of consecutive downtime for a MonitorTarget (opened/resolved on up<->down transitions)."""

    __tablename__ = "monitor_incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("monitor_targets.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | resolved
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    target: Mapped["MonitorTarget"] = relationship(back_populates="incidents")


class NotificationTemplate(Base):
    """Editable Jinja templates for outbound notification channels."""

    __tablename__ = "notification_templates"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "channel",
            "alert_type",
            name="uq_notification_template_org_channel_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    channel: Mapped[str] = mapped_column(String(50))  # email | teams
    # Specific alert_type, or "*" for the channel default fallback
    alert_type: Mapped[str] = mapped_column(String(100), default="*")
    subject_template: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Subdomain(Base):
    __tablename__ = "subdomains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id"))
    hostname: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_discovered: Mapped[bool] = mapped_column(Boolean, default=False)
    ssl_monitor: Mapped[bool] = mapped_column(Boolean, default=True)
    ssl_auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    domain: Mapped["Domain"] = relationship(back_populates="subdomains")
    ssl_certificates: Mapped[List["SSLCertificate"]] = relationship(back_populates="subdomain", cascade="all, delete-orphan")
    snapshots: Mapped[List["SubdomainSnapshot"]] = relationship(back_populates="subdomain", cascade="all, delete-orphan")


class SubdomainSnapshot(Base):
    __tablename__ = "subdomain_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subdomain_id: Mapped[int] = mapped_column(ForeignKey("subdomains.id"))
    snapshot_type: Mapped[str] = mapped_column(String(50))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    subdomain: Mapped["Subdomain"] = relationship(back_populates="snapshots")


class SSLCertificate(Base):
    __tablename__ = "ssl_certificates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    domain_id: Mapped[Optional[int]] = mapped_column(ForeignKey("domains.id"), nullable=True)
    subdomain_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subdomains.id"), nullable=True)
    hostname: Mapped[str] = mapped_column(String(255), index=True)
    issuer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    valid_from: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    days_remaining: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(50), default="unknown")
    protocol: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    cipher: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sans: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    is_wildcard: Mapped[bool] = mapped_column(Boolean, default=False)
    cert_type: Mapped[str] = mapped_column(String(30), default="external")  # external | letsencrypt | self_signed
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    managed: Mapped[bool] = mapped_column(Boolean, default=False)
    acme_status: Mapped[str] = mapped_column(String(50), default="none")
    challenge_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    challenge_dns_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    challenge_dns_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    challenges: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    cert_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    key_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    domain: Mapped[Optional["Domain"]] = relationship(back_populates="ssl_certificates")
    subdomain: Mapped[Optional["Subdomain"]] = relationship(back_populates="ssl_certificates")
    check_history: Mapped[List["SSLCheckHistory"]] = relationship(back_populates="certificate", cascade="all, delete-orphan")


class SSLCheckHistory(Base):
    __tablename__ = "ssl_check_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    certificate_id: Mapped[int] = mapped_column(ForeignKey("ssl_certificates.id"))
    is_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    days_remaining: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="unknown")
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    certificate: Mapped["SSLCertificate"] = relationship(back_populates="check_history")


class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)
    value_type: Mapped[str] = mapped_column(String(20), default="string")
    category: Mapped[str] = mapped_column(String(50), default="general")
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
