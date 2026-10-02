from datetime import datetime, timezone
from moeazi_agent.safety_change_quorum_scenarios import evaluate_fixture

def test_break_glass_never_escalates_and_revoke_failure_pauses():
    now=datetime.now(timezone.utc)
    forbidden=evaluate_fixture("lease-forbidden-escalation","enforce",now,"operator:fixture","a"*64)
    failed=evaluate_fixture("lease-revoke-failure","enforce",now,"operator:fixture","a"*64)
    assert forbidden["leaseUseStatus"] == "blocked" and failed["leaseState"] == "paused_fail_closed"
