from moeazi_agent.tracing import sanitize


def test_trace_sanitizer_removes_credentials_and_caps_content():
    cleaned = sanitize({
        "authorization": "Bearer visible-token",
        "nested": {
            "api_key": "sk-this-must-never-be-visible",
            "message": "use sk-another-secret-value in this prompt",
        },
        "long": "x" * 5_000,
    })

    assert cleaned["authorization"] == "[REDACTED]"
    assert cleaned["nested"]["api_key"] == "[REDACTED]"
    assert "sk-another" not in cleaned["nested"]["message"]
    assert len(cleaned["long"]) == 4_000


def test_trace_sanitizer_bounds_collections():
    cleaned = sanitize({f"field-{index}": index for index in range(100)})
    assert len(cleaned) == 60
