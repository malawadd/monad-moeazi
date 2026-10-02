from datetime import datetime, timezone

import pytest

from moeazi_agent.capability_delegation_canonical import digest
from moeazi_agent.capability_delegation_registry import fixture_grants, verify_registry
from moeazi_agent.capability_delegation_scenarios import evaluate_fixture, scenario_registry
from moeazi_agent.capability_delegation_workflow import reduce_transitions


NOW = datetime(2026, 8, 12, tzinfo=timezone.utc)


def test_registry_and_full_adversarial_corpus_are_closed_and_pass():
    verify_registry()
    assert len(fixture_grants(NOW)) == 6
    results = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64)
               for item in scenario_registry()]
    assert results and all(item["invariantVerdict"] == "pass" for item in results)


def test_capability_contracts_reject_float_and_unbounded_subordinate_expiry():
    grant = fixture_grants(NOW)[1]
    floating = grant.model_dump(exclude={"grant_hash"}, round_trip=True); floating["per_call_native"] = 1.5
    with pytest.raises(ValueError): grant.__class__(**floating, grant_hash="0" * 64)
    body = grant.model_dump(exclude={"grant_hash"}); body["effective_until"] = None
    with pytest.raises(ValueError): grant.__class__(**body, grant_hash=digest(body))


def test_local_transition_reducer_never_treats_pending_as_dispatchable():
    grant = fixture_grants(NOW)[0]
    from moeazi_agent.capability_delegation_contracts import GrantLifecycleTransition
    rows = []; predecessor = None
    for sequence, (before, after) in enumerate((("requested", "awaiting_user"),
            ("awaiting_user", "submitted"), ("submitted", "active_verified"),
            ("active_verified", "pending_revocation")), 1):
        body = {"grant_hash": grant.grant_hash, "predecessor_hash": predecessor, "from_state": before,
            "to_state": after, "sequence": sequence, "transitioned_at": NOW,
            "trigger_hash": digest({"fixture": "pending", "sequence": sequence})}
        row = GrantLifecycleTransition(**body, transition_hash=digest(body)); rows.append(row); predecessor = row.transition_hash
    result = reduce_transitions(grant.grant_hash, rows)
    assert result["dispatchDisabled"] is True and result["state"] == "pending_revocation"
