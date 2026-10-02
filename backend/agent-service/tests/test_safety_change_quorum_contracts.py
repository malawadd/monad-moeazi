from datetime import datetime, timezone
import pytest
from moeazi_agent.safety_change_quorum_canonical import json_loads_strict
from moeazi_agent.safety_change_quorum_scenarios import evaluate_fixture

def test_canonical_rejects_duplicate_keys_and_success_is_untrusted():
    with pytest.raises(ValueError, match="duplicate"): json_loads_strict('{"a":1,"a":2}')
    result=evaluate_fixture("two-distinct-synthetic-humans","enforce",datetime.now(timezone.utc),"operator:fixture","a"*64)
    assert result["productQualificationStatus"] == "unknown" and result["authorityEffect"] == "none"
