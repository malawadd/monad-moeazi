from datetime import datetime, timezone
import pytest
from moeazi_agent.safety_change_quorum_test_center_adapter import evaluate

def test_adapter_is_scenario_only_and_projects_no_product_authority():
    result=evaluate("two-distinct-synthetic-humans","observe",datetime.now(timezone.utc),"operator:fixture","a"*64)
    assert result["productOutcome"] == "unavailable" and result["authorityEffect"] == "none"
    with pytest.raises(ValueError): evaluate("https:caller-path","observe",datetime.now(timezone.utc),"operator:fixture","a"*64)
