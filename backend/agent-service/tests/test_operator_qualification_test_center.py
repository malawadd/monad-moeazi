from datetime import datetime, timezone
import inspect
import pytest
from moeazi_agent.operator_qualification_test_center_adapter import evaluate
from moeazi_agent.test_center_common import sanitize_artifact

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def test_adapter_accepts_only_checked_in_scenarios_and_preserves_frozen_result():
    result=evaluate("qualification-pass-independent-review","observe",NOW,"operator:test","a"*64)
    assert result["productOutcome"]=="unavailable" and "_artifacts" in result
    manifest=result["_artifacts"]["manifest"]
    with pytest.raises(Exception): manifest.scope_hash="f"*64
    assert set(inspect.signature(evaluate).parameters)=={"scenario_id","mode","now","operator","run_hash"}
    with pytest.raises(ValueError): evaluate("customer:url","observe",NOW,"operator:test","a"*64)

def test_sanitizer_rejects_urls_credentials_commands_and_float_controls():
    for value in ({"url":"https://x"},{"credential":"x"},{"command":"../x"},{"score":1.5}):
        with pytest.raises(ValueError): sanitize_artifact(value)

def test_adapter_has_no_redis_or_external_recovery_path():
    source=inspect.getsource(evaluate)
    assert "redis" not in source.lower() and "http" not in source.lower() and "control" not in source.lower()
