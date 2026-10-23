from app.routers.settings import _normalize_setting_value, is_valid_timezone

import pytest
from fastapi import HTTPException


def test_valid_timezones():
    assert is_valid_timezone("UTC")
    assert is_valid_timezone("America/Argentina/Buenos_Aires")


@pytest.mark.parametrize("value", ["", "Not/AZone", None, 5, "../etc/passwd"])
def test_invalid_timezones(value):
    assert not is_valid_timezone(value)


def test_timezone_setting_is_validated_and_trimmed():
    assert _normalize_setting_value("timezone", " Europe/Madrid ") == "Europe/Madrid"
    with pytest.raises(HTTPException):
        _normalize_setting_value("timezone", "Mars/Olympus")
