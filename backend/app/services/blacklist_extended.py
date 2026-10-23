from __future__ import annotations

import asyncio
from urllib.parse import quote

import dns.resolver
import httpx

from app.services.network_utils import is_valid_ipv4
from app.settings_store import SettingsStore

DNSBL_LISTS: dict[str, dict[str, str]] = {
    "zen.spamhaus.org": {"name": "Spamhaus ZEN", "category": "spamhaus", "url": "https://www.spamhaus.org/zen/", "dqs_zone": "zen"},
    "sbl.spamhaus.org": {"name": "Spamhaus SBL", "category": "spamhaus", "url": "https://www.spamhaus.org/sbl/", "dqs_zone": "sbl"},
    "xbl.spamhaus.org": {"name": "Spamhaus XBL", "category": "spamhaus", "url": "https://www.spamhaus.org/xbl/", "dqs_zone": "xbl"},
    "pbl.spamhaus.org": {"name": "Spamhaus PBL", "category": "spamhaus", "url": "https://www.spamhaus.org/pbl/", "dqs_zone": "pbl"},
    "b.barracudacentral.org": {"name": "Barracuda BRBL", "category": "enterprise", "url": "http://www.barracudacentral.org/rbl"},
    "dnsbl-1.uceprotect.net": {"name": "UCEProtect L1", "category": "enterprise", "url": "http://www.uceprotect.net/"},
    "dnsbl-2.uceprotect.net": {"name": "UCEProtect L2", "category": "enterprise", "url": "http://www.uceprotect.net/"},
    "dnsbl-3.uceprotect.net": {"name": "UCEProtect L3", "category": "enterprise", "url": "http://www.uceprotect.net/"},
    "bl.spamcop.net": {"name": "SpamCop", "category": "spam", "url": "https://www.spamcop.net/"},
    "psbl.surriel.com": {"name": "PSBL", "category": "spam", "url": "https://psbl.surriel.com/"},
    "rbl.s5h.net": {"name": "s5h.net", "category": "spam", "url": "http://www.s5h.net/"},
    "bl.0spam.org": {"name": "0spam BL", "category": "spam", "url": "https://0spam.org/"},
    "rbl.0spam.org": {"name": "0spam RBL", "category": "spam", "url": "https://0spam.org/"},
    "spam.dnsbl.anonmails.de": {"name": "AnonMails", "category": "spam", "url": "https://anonmails.de/"},
    "spambot.bls.digibase.ca": {"name": "Digibase Spambot", "category": "spam", "url": "http://www.digibase.ca/"},
    "z.mailspike.net": {"name": "Mailspike Z", "category": "spam", "url": "https://mailspike.net/"},
    "spamsources.fabel.dk": {"name": "Fabel Spamsources", "category": "spam", "url": "https://spamsources.fabel.dk/"},
    "blacklist.woody.ch": {"name": "Woody Blacklist", "category": "spam", "url": "https://blacklist.woody.ch/"},
    "spam.rbl.imp.ch": {"name": "IMP Spam RBL", "category": "spam", "url": "https://imp.ch/"},
    "relays.nether.net": {"name": "Nether Relays", "category": "spam", "url": "https://nether.net/"},
    "cbl.abuseat.org": {"name": "CBL (Abuseat)", "category": "botnet", "url": "https://www.abuseat.org/"},
    "dnsbl.dronebl.org": {"name": "DroneBL", "category": "botnet", "url": "https://dronebl.org/"},
    "drone.abuse.ch": {"name": "Abuse.ch Drone", "category": "botnet", "url": "https://abuse.ch/"},
    "spam.abuse.ch": {"name": "Abuse.ch Spam", "category": "botnet", "url": "https://abuse.ch/"},
    "combined.abuse.ch": {"name": "Abuse.ch Combined", "category": "botnet", "url": "https://abuse.ch/"},
    "worm.rbl.imp.ch": {"name": "IMP Worm RBL", "category": "botnet", "url": "https://imp.ch/"},
    "virus.rbl.jp": {"name": "VirusRBL Japan", "category": "botnet", "url": "http://www.rbl.jp/"},
    "ips.backscatterer.org": {"name": "Backscatterer", "category": "backscatter", "url": "http://www.backscatterer.org/"},
    "bogons.cymru.com": {"name": "Team Cymru Bogons", "category": "bogon", "url": "https://team-cymru.com/"},
    "dyna.spamrats.com": {"name": "SpamRATS DYNA", "category": "spamrats", "url": "https://www.spamrats.com/"},
    "noptr.spamrats.com": {"name": "SpamRATS NoPTR", "category": "spamrats", "url": "https://www.spamrats.com/"},
    "spam.spamrats.com": {"name": "SpamRATS SPAM", "category": "spamrats", "url": "https://www.spamrats.com/"},
}

# Spamhaus returns these when the query is refused (open resolver / typo / rate limit),
# not when the IP is actually listed. Cloudflare DoH always triggers .254 on public mirrors.
SPAMHAUS_POLICY_CODES = frozenset({
    "127.255.255.252",
    "127.255.255.254",
    "127.255.255.255",
})


def _is_valid_listing_code(code: str) -> bool:
    """Real DNSBL hits are 127.x.x.x excluding Spamhaus policy replies."""
    if not code or code in SPAMHAUS_POLICY_CODES:
        return False
    parts = code.split(".")
    if len(parts) != 4:
        return False
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return False
    if any(n < 0 or n > 255 for n in nums):
        return False
    # Conventional DNSBL answer space; exclude 127.255.255.x policy range.
    return nums[0] == 127 and not (nums[1] == 255 and nums[2] == 255)


def _result(
    meta: dict[str, str],
    *,
    listed: bool,
    error: bool,
    code: str = "",
    skipped: bool = False,
    skip_reason: str = "",
) -> dict:
    return {
        "name": meta["name"],
        "category": meta["category"],
        "url": meta["url"],
        "listed": listed,
        "error": error,
        "code": code,
        "skipped": skipped,
        "skip_reason": skip_reason,
    }


def _interpret_a_answer(meta: dict[str, str], code: str) -> dict:
    if code in SPAMHAUS_POLICY_CODES:
        return _result(meta, listed=False, error=True, code=code)
    if not _is_valid_listing_code(code):
        return _result(meta, listed=False, error=True, code=code)
    return _result(meta, listed=True, error=False, code=code)


async def _check_dnsbl_doh(client: httpx.AsyncClient, qname: str, meta: dict[str, str]) -> dict:
    url = f"https://cloudflare-dns.com/dns-query?name={quote(qname)}&type=A"
    try:
        response = await client.get(url, headers={"Accept": "application/dns-json"})
        data = response.json()
        answers = data.get("Answer") or []
        if data.get("Status") != 0 or not answers:
            return _result(meta, listed=False, error=False)
        return _interpret_a_answer(meta, answers[0].get("data", ""))
    except Exception:
        return _result(meta, listed=False, error=True)


async def _check_dnsbl_local(qname: str, meta: dict[str, str]) -> dict:
    """Query via the system resolver (needed for public Spamhaus mirrors / SpamRATS)."""
    try:
        answers = await asyncio.to_thread(dns.resolver.resolve, qname, "A", lifetime=4)
        return _interpret_a_answer(meta, str(answers[0]))
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return _result(meta, listed=False, error=False)
    except Exception:
        return _result(meta, listed=False, error=True)


async def _check_spamhaus(
    client: httpx.AsyncClient,
    rev_ip: str,
    host: str,
    meta: dict[str, str],
    dqs_key: str,
) -> dict:
    """Prefer Spamhaus DQS (works over public DoH). Fall back to public mirrors via local DNS."""
    if dqs_key:
        zone = meta.get("dqs_zone") or host.split(".")[0]
        qname = f"{rev_ip}.{dqs_key}.{zone}.dq.spamhaus.net"
        return await _check_dnsbl_doh(client, qname, meta)
    return await _check_dnsbl_local(f"{rev_ip}.{host}", meta)


async def _check_spamrats(rev_ip: str, host: str, meta: dict[str, str], spamrats_key: str) -> dict:
    if not spamrats_key:
        return _result(
            meta,
            listed=False,
            error=False,
            skipped=True,
            skip_reason="missing_spamrats_key",
        )
    # SpamRATS blocks many public resolvers / DoH; use system DNS with key injection.
    qname = f"{rev_ip}.{spamrats_key}.{host}"
    return await _check_dnsbl_local(qname, meta)


async def _check_abuseipdb(client: httpx.AsyncClient, ip: str, api_key: str) -> dict | None:
    if not api_key:
        return None
    try:
        response = await client.get(
            "https://api.abuseipdb.com/api/v2/check",
            params={"ipAddress": ip},
            headers={"Key": api_key, "Accept": "application/json"},
        )
        data = response.json()
        if "data" in data:
            d = data["data"]
            return {
                "score": d.get("abuseConfidenceScore"),
                "totalReports": d.get("totalReports"),
                "lastReportedAt": d.get("lastReportedAt"),
            }
    except Exception:
        pass
    return None


def _is_public_ipv4(ip: str) -> bool:
    parts = [int(p) for p in ip.split(".")]
    if parts[0] == 10:
        return False
    if parts[0] == 172 and 16 <= parts[1] <= 31:
        return False
    if parts[0] == 192 and parts[1] == 168:
        return False
    if parts[0] == 127:
        return False
    if parts[0] >= 224:
        return False
    return True


async def check_ip_blacklists(ip: str) -> dict:
    if not is_valid_ipv4(ip):
        raise ValueError("IP inválida (solo IPv4 soportada)")

    if not _is_public_ipv4(ip):
        return {
            "private": True,
            "note": "La IP es privada o reservada (LAN). Las listas negras no aplican.",
        }

    rev = ".".join(reversed(ip.split(".")))
    spamrats_key = SettingsStore.get_str("spamrats_key")
    abuse_key = SettingsStore.get_str("abuseipdb_key")
    dqs_key = SettingsStore.get_str("spamhaus_dqs_key")

    async with httpx.AsyncClient(timeout=4) as client:
        tasks = []
        for host, meta in DNSBL_LISTS.items():
            cat = meta["category"]
            if cat == "spamhaus":
                tasks.append(_check_spamhaus(client, rev, host, meta, dqs_key))
            elif cat == "spamrats":
                tasks.append(_check_spamrats(rev, host, meta, spamrats_key))
            else:
                tasks.append(_check_dnsbl_doh(client, f"{rev}.{host}", meta))
        dnsbl_results = await asyncio.gather(*tasks)
        abuse_data = await _check_abuseipdb(client, ip, abuse_key)

    active = [r for r in dnsbl_results if not r.get("skipped")]
    listed_count = sum(1 for r in active if r["listed"])
    return {
        "private": False,
        "clean": listed_count == 0,
        "total": len(active),
        "listed": listed_count,
        "dnsbl": list(dnsbl_results),
        "abuseipdb": abuse_data,
        "fortiguard": f"https://www.fortiguard.com/search?q={ip}&engine=8",
        "keys": {
            "abuseipdb": bool(abuse_key),
            "spamrats": bool(spamrats_key),
            "spamhaus_dqs": bool(dqs_key),
        },
    }
