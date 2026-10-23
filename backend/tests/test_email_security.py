import asyncio

from app.services import domain_scanner


class Exchange:
    def __init__(self, value: str):
        self.value = value
        self.exchange = self

    def __str__(self) -> str:
        return self.value


class Record:
    def __init__(self, value: str):
        self.value = value

    def __str__(self) -> str:
        return self.value


def test_missing_spf_is_scored_even_when_other_txt_records_exist(monkeypatch):
    def resolve(name: str, record_type: str, lifetime: int):
        if record_type == "TXT" and name == "example.com":
            return [Record("google-site-verification=abc")]
        if record_type == "TXT" and name == "_dmarc.example.com":
            return [Record("v=DMARC1; p=quarantine")]
        if record_type == "MX":
            return [Exchange("mail.example.com.")]
        raise RuntimeError("not found")

    monkeypatch.setattr(domain_scanner.dns.resolver, "resolve", resolve)
    report = asyncio.run(domain_scanner.analyze_email_security("example.com"))

    assert report.score == 55
    assert report.spf["found"] is False
    assert report.dmarc["found"] is True
    assert report.mx_records == ["mail.example.com."]
    assert "No SPF record found" in report.recommendations
    assert "No DKIM records found for common selectors" in report.recommendations
