#!/usr/bin/env python3
"""FacuTools CLI - Command-line interface for domain management."""

import argparse
import json
import os
import sys

import httpx

API_BASE = os.environ.get("DOMAINTOOLS_API", "http://localhost:8000/api")
TOKEN = os.environ.get("DOMAINTOOLS_TOKEN", "")


def _headers():
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    return headers


def _client():
    return httpx.Client(headers=_headers(), timeout=60.0)


def cmd_list(args):
    with _client() as client:
        r = client.get(f"{API_BASE}/domains")
        r.raise_for_status()
        domains = r.json()
    if not domains:
        print("No domains found.")
        return
    for d in domains:
        status = "UP" if d.get("latest_health", {}) and d["latest_health"].get("is_up") else "—"
        print(f"  {d['name']:30} {d.get('registrar', '—'):20} {status}")


def cmd_add(args):
    with _client() as client:
        r = client.post(f"{API_BASE}/domains", json={"name": args.domain})
        r.raise_for_status()
        print(f"Added: {r.json()['name']}")


def cmd_scan(args):
    with _client() as client:
        domains = client.get(f"{API_BASE}/domains").json()
        domain = next((d for d in domains if d["name"] == args.domain), None)
        if not domain:
            print(f"Domain {args.domain} not found. Add it first.")
            sys.exit(1)
        print(f"Scanning {args.domain}...")
        result = client.post(f"{API_BASE}/domains/{domain['id']}/scan").json()
        print(json.dumps(result, indent=2, default=str))


def cmd_whois(args):
    with _client() as client:
        result = client.get(f"{API_BASE}/tools/whois/{args.domain}").json()
        print(json.dumps(result, indent=2, default=str))


def cmd_stats(args):
    with _client() as client:
        stats = client.get(f"{API_BASE}/domains/stats").json()
    print(f"Total domains:    {stats['total_domains']}")
    print(f"Expiring soon:    {stats['expiring_soon']}")
    print(f"Portfolio value:  ${stats['total_value']:,.2f}")
    print(f"Domains online:   {stats['domains_up']}")
    print(f"Domains offline:  {stats['domains_down']}")
    print(f"SSL expiring:     {stats['ssl_expiring_soon']}")
    print(f"Recent alerts:    {stats['recent_alerts']}")


def cmd_login(args):
    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            f"{API_BASE}/auth/login",
            json={"email": args.email, "password": args.password},
        )
        r.raise_for_status()
        data = r.json()
    print(data["access_token"])
    print(
        "\n# Export for subsequent commands:\n"
        f"export DOMAINTOOLS_TOKEN={data['access_token']}",
        file=sys.stderr,
    )


def main():
    parser = argparse.ArgumentParser(description="FacuTools CLI")
    sub = parser.add_subparsers(dest="command")

    p_login = sub.add_parser("login", help="Login and print access token")
    p_login.add_argument("email")
    p_login.add_argument("password")
    p_login.set_defaults(func=cmd_login)

    p_list = sub.add_parser("list", help="List all domains")
    p_list.set_defaults(func=cmd_list)

    p_add = sub.add_parser("add", help="Add a domain")
    p_add.add_argument("domain")
    p_add.set_defaults(func=cmd_add)

    p_scan = sub.add_parser("scan", help="Full scan a domain")
    p_scan.add_argument("domain")
    p_scan.set_defaults(func=cmd_scan)

    p_whois = sub.add_parser("whois", help="WHOIS lookup")
    p_whois.add_argument("domain")
    p_whois.set_defaults(func=cmd_whois)

    p_stats = sub.add_parser("stats", help="Portfolio statistics")
    p_stats.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    if args.command != "login" and not TOKEN:
        print("Set DOMAINTOOLS_TOKEN (see: domaintools.py login EMAIL PASS)", file=sys.stderr)
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
