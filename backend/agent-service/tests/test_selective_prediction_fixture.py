import pytest
from moeazi_agent.selective_prediction_calibrator import fit, project
from moeazi_agent.selective_prediction_canonical import load
from moeazi_agent.selective_prediction_evaluator import evaluate
from moeazi_agent.selective_prediction_oracle import expected
from moeazi_agent.selective_prediction_registry import mutations, scenarios

def bindings(): return {name: {"trustStatus":"requires_revalidation", "zeroAttempts":True, "notAuthorizing":True} for name in ("manipulation-aware-evidence-integrity", "portfolio-aware-sizing", "outcome-calibrated-promotion")}
def test_replay_oracle_and_zero_attempt_ceiling():
    assert len(scenarios()) == 96 and len(mutations()) == 256
    for row in scenarios():
        result = evaluate(row["id"], "enforce", "operator-fixture", "a" * 64, bindings())
        assert result["effectiveState"] == expected(row["id"], "enforce")
        assert all(result[key] == 0 for key in ("providerAttempts","externalAttempts","networkAttempts","workflowAttempts","signerAttempts","walletAttempts","venueAttempts","executionAttempts","creditAttempts","providerCost"))
        assert result["proposalCreated"] is False and result["productOutcome"] == "unavailable"
def test_observe_caps_promotion_and_precedence_fails_closed():
    assert evaluate("selective-prediction-001", "observe", "operator", "b" * 64, bindings())["effectiveState"] == "shadow_only"
    assert evaluate("selective-prediction-001", "enforce", "operator", "c" * 64, None)["effectiveState"] == "abstain"
    assert evaluate("selective-prediction-012", "enforce", "operator", "d" * 64, bindings())["effectiveState"] == "abstain"
def test_canonical_rejects_duplicate_and_float_and_quantile_is_integer_only():
    with pytest.raises(ValueError): load('{"a":1,"a":2}')
    with pytest.raises(ValueError): load('{"a":1.1}')
    with pytest.raises(ValueError): fit(())
    assert project((9200,400,400), 600, 800, 25) == (("long",), 575, 625)
