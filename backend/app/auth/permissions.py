"""Permission catalog and system role definitions."""

from __future__ import annotations

from typing import Dict, List, Set

PERMISSIONS: List[Dict[str, str]] = [
    {"code": "domains:read", "description": "View domains"},
    {"code": "domains:write", "description": "Create and update domains"},
    {"code": "domains:delete", "description": "Delete domains"},
    {"code": "subdomains:read", "description": "View subdomains"},
    {"code": "subdomains:write", "description": "Create and update subdomains"},
    {"code": "subdomains:delete", "description": "Delete subdomains"},
    {"code": "ssl:read", "description": "View SSL certificates"},
    {"code": "ssl:write", "description": "Request and renew SSL certificates"},
    {"code": "ssl:download", "description": "Download SSL private keys"},
    {"code": "alerts:read", "description": "View alerts and rules"},
    {"code": "alerts:write", "description": "Manage alerts and rules"},
    {"code": "watchlist:read", "description": "View watchlist"},
    {"code": "watchlist:write", "description": "Manage watchlist"},
    {"code": "monitoring:read", "description": "View own-systems monitoring targets and uptime"},
    {"code": "monitoring:write", "description": "Manage own-systems monitoring targets"},
    {"code": "tools:use", "description": "Use domain toolbox"},
    {"code": "network:use", "description": "Use network tools"},
    {"code": "settings:read", "description": "View application settings"},
    {"code": "settings:write", "description": "Update application settings"},
    {"code": "users:read", "description": "View organization members"},
    {"code": "users:write", "description": "Invite and manage members"},
    {"code": "roles:read", "description": "View roles and permissions"},
    {"code": "roles:write", "description": "Create and edit custom roles"},
    {"code": "org:manage", "description": "Manage organization settings"},
    {"code": "sso:manage", "description": "Configure SSO identity providers"},
]

ALL_PERMISSION_CODES: Set[str] = {p["code"] for p in PERMISSIONS}

OPERATOR_PERMISSIONS: Set[str] = {
    "domains:read",
    "domains:write",
    "domains:delete",
    "subdomains:read",
    "subdomains:write",
    "subdomains:delete",
    "ssl:read",
    "ssl:write",
    "ssl:download",
    "alerts:read",
    "alerts:write",
    "watchlist:read",
    "watchlist:write",
    "monitoring:read",
    "monitoring:write",
    "tools:use",
    "network:use",
}

VIEWER_PERMISSIONS: Set[str] = {
    "domains:read",
    "subdomains:read",
    "ssl:read",
    "alerts:read",
    "watchlist:read",
    "monitoring:read",
    "tools:use",
    "network:use",
}

SYSTEM_ROLES: Dict[str, Set[str]] = {
    "Admin": ALL_PERMISSION_CODES,
    "Operator": OPERATOR_PERMISSIONS,
    "Viewer": VIEWER_PERMISSIONS,
}

SYSTEM_ROLE_DESCRIPTIONS: Dict[str, str] = {
    "Admin": "Full access to the organization",
    "Operator": "Manage portfolio, SSL, alerts, and tools",
    "Viewer": "Read-only access to portfolio and tools",
}
