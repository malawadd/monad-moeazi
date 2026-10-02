from datetime import datetime, timezone
from moeazi_agent.safety_change_quorum_scenarios import evaluate_fixture

def test_replay_has_stable_hashes_at_frozen_time():
    now=datetime(2026,1,1,tzinfo=timezone.utc)
    left=evaluate_fixture("two-distinct-synthetic-humans","enforce",now,"operator:fixture","a"*64)
    right=evaluate_fixture("two-distinct-synthetic-humans","enforce",now,"operator:fixture","a"*64)
    assert left["decisionHash"] == right["decisionHash"] == left["decisionHash"]
