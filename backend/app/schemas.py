from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class DomainCreate(BaseModel):
    name: str
    registrar: Optional[str] = None
    purchase_price: Optional[float] = None
    renewal_cost: Optional[float] = None
    estimated_value: Optional[float] = None
    expires_at: Optional[datetime] = None
    auto_renew: bool = False
    notes: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class DomainUpdate(BaseModel):
    registrar: Optional[str] = None
    status: Optional[str] = None
    purchase_price: Optional[float] = None
    renewal_cost: Optional[float] = None
    estimated_value: Optional[float] = None
    expires_at: Optional[datetime] = None
    auto_renew: Optional[bool] = None
    monitor_method: Optional[Literal["http", "ping", "tcp", "dns", "ssl"]] = None
    monitor_port: Optional[int] = Field(default=None, ge=1, le=65535)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class DomainResponse(BaseModel):
    id: int
    name: str
    registrar: Optional[str]
    status: str
    purchase_price: Optional[float]
    renewal_cost: Optional[float]
    estimated_value: Optional[float]
    expires_at: Optional[datetime]
    auto_renew: bool
    monitor_method: str = "http"
    monitor_port: Optional[int] = None
    notes: Optional[str]
    tags: List[str]
    created_at: datetime
    updated_at: datetime
    days_until_expiry: Optional[int] = None
    latest_health: Optional[dict] = None
    last_scanned_at: Optional[datetime] = None
    next_scan_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BulkImportRequest(BaseModel):
    domains: List[DomainCreate]


class DomainValidateRequest(BaseModel):
    name: str


class DomainValidateResponse(BaseModel):
    valid: bool
    normalized: str
    available: bool
    error: Optional[str] = None


class DomainNotificationSettings(BaseModel):
    preferences: Dict[str, bool] = Field(default_factory=dict)
    include_subdomains: bool = True


class DomainSetupRequest(BaseModel):
    name: str
    registrar: Optional[str] = None
    expires_at: Optional[datetime] = None
    renewal_cost: Optional[float] = None
    notes: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    subdomains: List[str] = Field(default_factory=list)
    notifications: DomainNotificationSettings = Field(default_factory=DomainNotificationSettings)


class DomainSetupResponse(BaseModel):
    domain: DomainResponse
    subdomains: List[dict]
    notifications: DomainNotificationSettings


class DNSRecord(BaseModel):
    type: str
    name: str
    value: str
    ttl: Optional[int] = None


class SSLInfo(BaseModel):
    issuer: Optional[str]
    subject: Optional[str]
    valid_from: Optional[datetime]
    valid_until: Optional[datetime]
    days_remaining: Optional[int]
    is_valid: bool
    protocol: Optional[str] = None
    cipher: Optional[str] = None
    sans: List[str] = Field(default_factory=list)
    serial_number: Optional[str] = None
    signature_algorithm: Optional[str] = None
    key_type: Optional[str] = None
    key_bits: Optional[int] = None
    is_self_signed: bool = False
    trusted: bool = False
    trust_error: Optional[str] = None


class WHOISInfo(BaseModel):
    registrar: Optional[str]
    creation_date: Optional[datetime]
    expiration_date: Optional[datetime]
    updated_date: Optional[datetime]
    name_servers: List[str]
    status: List[str]
    registrant: Optional[str] = None


class EmailSecurityReport(BaseModel):
    domain: str
    spf: dict
    dkim: dict
    dmarc: dict
    mx_records: List[str]
    score: int
    recommendations: List[str]


class PropagationResult(BaseModel):
    resolver: str
    location: str
    records: List[str]
    propagated: bool


class TechStackResult(BaseModel):
    domain: str
    technologies: List[dict]
    server: Optional[str]
    cms: Optional[str]
    cdn: Optional[str]
    analytics: List[str]


class BlacklistResult(BaseModel):
    domain: str
    is_listed: bool
    blacklists_checked: int
    listings: List[dict]
    ip: Optional[str] = None
    abuseipdb: Optional[dict] = None
    fortiguard: Optional[str] = None
    source: Optional[str] = "extended"


class SubdomainResult(BaseModel):
    domain: str
    subdomains: List[dict]
    total_found: int
    total_checked: int = 0
    resolved_count: int = 0
    wildcard_detected: bool = False
    wildcard_filtered: int = 0
    warnings: List[str] = Field(default_factory=list)


class DomainComparison(BaseModel):
    domains: List[str]
    comparison: dict


class AlertRuleCreate(BaseModel):
    name: str
    rule_type: str
    condition: dict
    channels: List[str] = Field(default_factory=list)


class WatchlistCreate(BaseModel):
    domain_name: str
    target_price: Optional[float] = None
    notes: Optional[str] = None


class MonitorTargetCreate(BaseModel):
    name: str
    check_type: str = "http"
    target: str
    port: Optional[int] = None
    keyword: Optional[str] = None
    soap_action: Optional[str] = None
    request_body: Optional[str] = None
    interval_minutes: int = 5
    interval_seconds: Optional[int] = None
    warning_threshold_ms: Optional[int] = None
    critical_threshold_ms: Optional[int] = None
    is_active: bool = True
    is_public: bool = False


class MonitorTargetUpdate(BaseModel):
    name: Optional[str] = None
    check_type: Optional[str] = None
    target: Optional[str] = None
    port: Optional[int] = None
    keyword: Optional[str] = None
    soap_action: Optional[str] = None
    request_body: Optional[str] = None
    interval_minutes: Optional[int] = None
    interval_seconds: Optional[int] = None
    warning_threshold_ms: Optional[int] = None
    critical_threshold_ms: Optional[int] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None


class NotificationTemplateCreate(BaseModel):
    name: str
    channel: str
    alert_type: str = "*"
    subject_template: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    body_json: Optional[str] = None
    is_active: bool = True


class NotificationTemplateUpdate(BaseModel):
    name: Optional[str] = None
    channel: Optional[str] = None
    alert_type: Optional[str] = None
    subject_template: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    body_json: Optional[str] = None
    is_active: Optional[bool] = None


class NotificationTemplateResponse(BaseModel):
    id: int
    name: str
    channel: str
    alert_type: str
    subject_template: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    body_json: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NotificationTemplatePreviewRequest(BaseModel):
    channel: str = "email"
    subject_template: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    body_json: Optional[str] = None
    title: str = "SSL certificate expiring soon"
    message: str = "The certificate for example.com expires in 14 days."
    alert_type: str = "ssl_expiry"
    severity: str = "warning"
    domain_name: str = "example.com"


class DashboardStats(BaseModel):
    total_domains: int
    expiring_soon: int
    total_value: float
    total_renewal_cost: float
    domains_up: int
    domains_down: int
    ssl_expiring_soon: int
    recent_alerts: int
    by_registrar: Dict[str, int]
    by_status: Dict[str, int]
    portfolio_trend: List[dict]


class DomainScanResult(BaseModel):
    domain: str
    whois: Optional[WHOISInfo]
    dns: List[DNSRecord]
    ssl: Optional[SSLInfo]
    email_security: Optional[EmailSecurityReport]
    tech_stack: Optional[TechStackResult]
    blacklists: Optional[BlacklistResult]
    subdomains: Optional[SubdomainResult]
    health: Optional[dict]
    host_intel: Optional[dict] = None
    providers: Optional[List[dict]] = None
    rdap: Optional[dict] = None
