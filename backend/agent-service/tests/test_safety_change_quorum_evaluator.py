from datetime import datetime, timezone
from moeazi_agent.safety_change_quorum_scenarios import evaluate_fixture

def test_same_person_and_self_approval_fail_closed_but_stop_is_immediate():
    now=datetime.now(timezone.utc)
    assert evaluate_fixture("same-human-two-accounts","enforce",now,"operator:fixture","a"*64)["actualOutcome"] == "blocked"
    assert evaluate_fixture("self-approval","enforce",now,"operator:fixture","a"*64)["actualOutcome"] == "blocked"
    assert evaluate_fixture("immediate-stop","enforce",now,"operator:fixture","a"*64)["actualOutcome"] == "would_apply_restriction"
