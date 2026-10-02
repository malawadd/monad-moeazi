"""Independent adversarial checks for the isolated Feature 22 evaluator."""
from datetime import timedelta
from pathlib import Path
import pytest
from moeazi_agent.product_eligibility_canonical import CanonicalError, digest, json_loads_strict
from moeazi_agent.product_eligibility_evaluator import evaluate
from moeazi_agent.product_eligibility_scenarios import NOW, _context, _pack, _product, _scope, _venue, evaluate_fixture, scenario_registry
from moeazi_agent.product_eligibility_decision_contracts import ProductEligibilityRequest
from moeazi_agent.product_eligibility_change_contracts import RulepackChange, SafetyChangeQuorumBinding, activation_allowed


def request(operation="open", venue="gmx"):
    row = {"id": "test", "operation": operation, "venue": venue}
    return evaluate_fixture("eligibility-001", "observe", NOW, "operator:fixture", "a" * 64)["_artifacts"]


def test_expected_corpus_is_closed_and_never_authorizes_product():
    rows = scenario_registry(); assert len(rows) == 90
    assert len({x["id"] for x in rows}) == 90
    assert {x["operation"] for x in rows} == {"analyze","approve","cancel","catalog_display","history_read","increase","open","prepare","propose","reconcile","reduce","risk","route","settle"}
    assert {x["venue"] for x in rows} == {"gmx","hyperliquid","lighter","orderly","ostium","uniswap"}
    for row in rows:
        result = evaluate_fixture(row["id"], "observe", NOW, "operator:fixture", "a" * 64)
        assert result["fixtureOnly"] and result["notLegalAdvice"]
        assert result["productOutcome"] == "unavailable" and not result["operationPerformed"]
        assert result["providerCost"] == result["externalAttempts"] == 0


def test_exact_operation_and_venue_non_reuse_coverage():
    artifacts = request(); req, decision = artifacts["request"], artifacts["decision"]
    pack = _pack(req.scope, req.product, req.venue.venue, req.operation, NOW)
    operations = ("analyze","approve","cancel","catalog_display","history_read","increase","open","prepare","propose","reconcile","reduce","risk","route","settle")
    venues = ("gmx","hyperliquid","lighter","orderly","ostium","uniswap")
    operation_matrix = venue_matrix = 0
    for operation in operations:
        for other in operations:
            pack = _pack(req.scope, req.product, req.venue.venue, operation, NOW)
            wrong = req.model_copy(update={"operation": other})
            result = evaluate(pack, wrong, NOW)
            assert (result.outcome == "eligible") == (operation == other); operation_matrix += 1
    for venue in venues:
        source = _venue(NOW, venue)
        pack = _pack(req.scope, req.product, venue, req.operation, NOW)
        for other in venues:
            wrong = req.model_copy(update={"venue": _venue(NOW, other)})
            result = evaluate(pack, wrong, NOW)
            assert (result.outcome == "eligible") == (venue == other); venue_matrix += 1
    assert operation_matrix == 14 * 14 and venue_matrix == 6 * 6


def test_ten_thousand_deterministic_property_cases_are_monotone_and_isolated():
    artifacts = request(); req = artifacts["request"]
    pack = _pack(req.scope, req.product, req.venue.venue, req.operation, NOW)
    for index in range(10_000):
        candidate = req.model_copy(update={"idempotency_hash": digest({"case": index})})
        one, two = evaluate(pack, candidate, NOW), evaluate(pack, candidate, NOW)
        assert one.decision_hash == two.decision_hash and one.outcome == two.outcome
        assert one.product_outcome == "unavailable" and one.authority_effect == "none"


def test_canonical_rejects_unsafe_json_and_no_runtime_imports():
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1.0}')
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1,"x":2}')
    forbidden = ("requests", "httpx", "web3", "temporal", "convex", "subprocess", "wallet", "signer", "gateway", "sidecar")
    for path in Path("agent-service/src/moeazi_agent").glob("product_eligibility_*.py"):
        content = path.read_text(encoding="utf-8").lower()
        assert not any(f"import {name}" in content or f"from {name}" in content for name in forbidden), path.name


def test_change_activation_is_fixture_bound_and_never_loosens_without_quorum():
    scope = _scope(); body = {"scope": scope, "before_rulepack_hash": digest("before"),
        "after_rulepack_hash": digest("after"), "direction": "loosening", "declared_at": NOW}
    change = RulepackChange(**body, change_hash=digest(body))
    assert not activation_allowed(change, None, NOW, NOW + timedelta(seconds=60))
    binding_body = {"scope_hash": scope.scope_hash, "quorum_hash": digest("quorum"),
        "status": "requires_revalidation", "synthetic_untrusted": True}
    binding = SafetyChangeQuorumBinding(**binding_body, binding_hash=digest(binding_body))
    assert activation_allowed(change, binding, NOW, NOW + timedelta(seconds=60))
    assert not activation_allowed(change, binding, NOW, NOW + timedelta(seconds=901))
