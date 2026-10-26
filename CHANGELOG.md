# Changelog

All notable changes to FacuTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.7] — 2026-10-26

### Removed
- Domain comparison tool (page, sidebar entry, `POST /api/domains/compare`).

## [1.1.6] — 2026-10-26

### Fixed
- Domain comparator: names are validated, normalized and de-duplicated (2–5 domains), scans run in parallel, one failing domain no longer breaks the whole comparison, and errors are shown in the UI.

## [1.1.5] — 2026-10-26

### Added
- Edit a domain's alert preferences and onboarding details (registrar, expiry, renewal cost, tags, notes) from the domain detail page; new `GET/PUT /api/domains/{id}/notifications`.
- `/api/health` returns the app version; the sidebar shows it instead of a hardcoded value.

### Changed
- Dashboard no longer shows the portfolio value card.
- Alerts page lists only unread alerts.

## [1.1.4] — 2026-08-03

### Changed
- Domain monitoring is a **due queue**: each tick scans at most `monitor_batch_size` domains (default **1**), never the full portfolio in one burst. Per-domain cadence via `next_scan_at` / `monitor_interval_minutes`.

### Added
- Settings `monitor_tick_minutes` and `monitor_batch_size`.
- `domains.last_scanned_at` and `domains.next_scan_at` columns.

## [1.1.3] — 2026-08-03

### Fixed
- App no longer sits on “Loading…” for ~1 minute after restart: the first scheduled portfolio/SSL scan is delayed (~90s), scans release the DB during network I/O, and auth bootstrap times out after 12s instead of hanging.

## [1.1.2] — 2026-08-03

### Added
- Automatic scan change detection for IP, DNS, registrar, WHOIS status/expiry, and SSL certificate diffs → in-app Alerts (+ external channels when configured).
- Recommended notification defaults (expiry, SSL, downtime, security, IP/DNS/registrar) and one-time upgrade of legacy narrow prefs.

### Changed
- Alerts page clarifies that monitoring runs on a schedule and links to My notifications / Settings for delivery.

## [1.1.1] — 2026-08-03

### Fixed
- Portfolio / domain scans no longer wait on the full 32-DNSBL catalog (use a fast **core** profile of ~7 DoH lists).
- Spamhaus without DQS key is skipped instead of blocking on local DNS (avoids thread-pool starvation and false policy codes).
- AbuseIPDB runs in parallel with DNSBL queries; DoH/local DNS concurrency is capped.
- Subdomain discovery is concurrency-limited so it does not stall the API during scans.

## [1.1.0] — 2026-08-03

### Changed
- Unified Toolbox and Network Tools into a single **Tools** hub at `/tools`, grouped by category.
- Removed duplicate DNS Propagation and Blacklist cards from Domain Analysis (use the richer dedicated tools).
- Asset detail links prefer built-in FacuTools tools where they overlap third-party services.
- Product version is read from a single root `VERSION` file (backend, frontend build, and UI).

### Added
- Root `VERSION` file and `CHANGELOG.md` as the product versioning source of truth.
- Legacy redirects from `/herramientas/*` to `/tools/*`.

## [1.0.0] — 2026-01-01

### Added
- Initial FacuTools release: domain portfolio, SSL monitoring, Toolbox, and Network/IPScope tools.
