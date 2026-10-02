from datetime import datetime, timezone
import pytest
from moeazi_agent.promotion_canonical import load
from moeazi_agent.promotion_evaluator import evaluate
from moeazi_agent.promotion_oracle import expected
from moeazi_agent.promotion_registry import mutations, scenarios

def bindings(): return {name:{"trustStatus":"requires_revalidation","zeroAttempts":True,"notAuthorizing":True} for name in ("calibrated-shadow-execution-tca","outcome-linked-decision-memory")}
def test_corpus_oracle_and_zero_attempt_ceiling():
    assert len(scenarios()) == 96 and len(mutations()) == 256
    for row in scenarios():
        result=evaluate(row["id"],"enforce","operator-fixture","a"*64,bindings())
        assert result["decision"] == expected(row["id"],"enforce")
        assert all(result[key] == 0 for key in ("providerAttempts","externalAttempts","networkAttempts","signerAttempts","walletAttempts","venueAttempts","executionAttempts","creditAttempts","providerCost"))
        assert not result["automaticActivationAvailable"] and not result["automaticRollbackAvailable"]
def test_observe_is_always_hold_and_precedence_is_total():
    assert evaluate("promotion-001","observe","operator-fixture","b"*64,bindings())["decision"] == "hold"
    assert evaluate("promotion-010","enforce","operator-fixture","c"*64,bindings())["decision"] == "kill"
    assert evaluate("promotion-001","enforce","operator-fixture","d"*64,None)["decision"] == "block"
def test_duplicate_json_and_float_are_rejected():
    with pytest.raises(ValueError): load('{"a":1,"a":2}')
    with pytest.raises(ValueError): load('{"a":1.1}')
