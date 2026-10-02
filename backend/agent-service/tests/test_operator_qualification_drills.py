from datetime import datetime, timedelta, timezone
from moeazi_agent.operator_qualification_evaluator import oracle
from moeazi_agent.operator_qualification_registry import raw
from moeazi_agent.operator_qualification_scenarios import evaluate_fixture

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def artifacts(scenario): return evaluate_fixture(scenario,"observe",NOW,"operator:test","a"*64)["_artifacts"]
def test_every_drill_family_has_integer_passing_oracle_with_required_actions():
    for family in raw()["drills"]:
        item=artifacts(f"qualification-pass-{family}" if family!="emergency-stop" else "qualification-pass-independent-review")
        receipt=oracle(item["attempt"],item["actions"],NOW)
        assert receipt.outcome=="pass" and type(receipt.score) is int and receipt.score==10000

def test_oracle_rejects_forbidden_order_deadline_and_missing_hard_step():
    item=artifacts("qualification-pass-alert-storm"); attempt=item["attempt"]; actions=item["actions"]
    forbidden=[actions[0].model_copy(update={"action_code":"venue:submit"}),actions[1]]
    assert "forbidden_action" in oracle(attempt,forbidden,NOW).reason_codes
    unordered=[actions[0].model_copy(update={"sequence":2}),actions[1]]
    assert "action_sequence_invalid" in oracle(attempt,unordered,NOW).reason_codes
    late=[actions[0].model_copy(update={"occurred_at":attempt.started_at+timedelta(seconds=601)}),actions[1]]
    assert "deadline_exceeded" in oracle(attempt,late,NOW).reason_codes
    missing=[actions[0].model_copy(update={"action_code":"alert:triage"})]
    assert "hard_safety_step_missing" in oracle(attempt,missing,NOW).reason_codes
