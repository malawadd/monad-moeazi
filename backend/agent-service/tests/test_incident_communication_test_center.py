from datetime import datetime, timezone
from moeazi_agent.incident_communication_test_center_adapter import evaluate

def test_adapter_accepts_only_checked_in_scenarios():
    result=evaluate("dependency-outage","observe",datetime(2026,1,1,tzinfo=timezone.utc),"operator:fixture","a"*64)
    assert result["actualOutcome"] == "would_send"
    try: evaluate("http-path","observe",datetime.now(timezone.utc),"operator:fixture","a"*64)
    except ValueError: pass
    else: raise AssertionError("caller selected scenario was accepted")
