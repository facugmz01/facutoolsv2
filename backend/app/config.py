"""Bootstrap config — only values needed before DB connection."""

import os
from pathlib import Path


_config_path = Path(__file__).resolve()
_version_candidates = (
	_config_path.parents[2] / "VERSION",
	_config_path.parents[1] / "VERSION",
)
VERSION_FILE = next((path for path in _version_candidates if path.is_file()), _version_candidates[0])
try:
	APP_VERSION = VERSION_FILE.read_text(encoding="utf-8").strip()
except OSError as exc:
	raise RuntimeError(f"Unable to read application version from {VERSION_FILE}") from exc
if not APP_VERSION:
	raise RuntimeError(f"Application version file is empty: {VERSION_FILE}")

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./domaintools.db")
# Optional path to Vite build (index.html + assets). Used by CloudPanel / single-process deploys.
FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "").strip()
SECRET_KEY = os.environ.get("SECRET_KEY", "").strip()
if not SECRET_KEY:
	raise RuntimeError("SECRET_KEY environment variable is required")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0").strip()
ENTRA_ONBOARDING_CLIENT_ID = os.environ.get("ENTRA_ONBOARDING_CLIENT_ID", "").strip()
ENTRA_ONBOARDING_CLIENT_SECRET = os.environ.get("ENTRA_ONBOARDING_CLIENT_SECRET", "").strip()
