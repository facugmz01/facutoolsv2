from app.services.dns_checker import _collect_cname_records, _parse_record, _query_status


def test_parse_mx_preserves_exact_rdata_and_parses_priority():
    record = _parse_record("MX", "10 mail.example.com.", 300)

    assert record["rdata"] == "10 mail.example.com."
    assert record["priority"] == "10"
    assert record["value"] == "mail.example.com"
    assert record["ttl"] == 300


def test_parse_txt_preserves_quotes_and_escaped_content():
    record = _parse_record("TXT", '"v=DKIM1; p=abc\\;123"', 60)

    assert record["rdata"] == '"v=DKIM1; p=abc\\;123"'
    assert record["value"] == '"v=DKIM1; p=abc\\;123"'


def test_parse_cname_preserves_rdata_and_normalizes_target():
    record = _parse_record("CNAME", "alias.example.com.", 300)

    assert record["rdata"] == "alias.example.com."
    assert record["value"] == "alias.example.com"
    assert record["ttl"] == 300


def test_collect_cname_records_includes_standard_subdomain_name():
    responses = {
        "CNAME": {"Status": 0},
        "CNAME_autodiscover": {
            "Answer": [{"type": 5, "data": "autodiscover.outlook.com.", "TTL": 3600}],
        },
    }

    records = _collect_cname_records("dulcor.com.ar", responses)

    assert records == [{
        "name": "autodiscover.dulcor.com.ar",
        "value": "autodiscover.outlook.com",
        "rdata": "autodiscover.outlook.com.",
        "ttl": 3600,
    }]


def test_parse_soa_keeps_original_rdata():
    rdata = "ns1.example.com. hostmaster.example.com. 2026092101 3600 600 86400 300"
    record = _parse_record("SOA", rdata, 900)

    assert record["rdata"] == rdata
    assert record["mname"] == "ns1.example.com"
    assert record["serial"] == "2026092101"


def test_query_status_distinguishes_missing_response_and_nxdomain():
    assert _query_status({"Status": 0}) == "NOERROR"
    assert _query_status({"Status": 3}) == "NXDOMAIN"
    assert _query_status(None) == "ERROR"