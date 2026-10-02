from datetime import datetime, timezone
import pytest

from moeazi_agent.temporal_integrity_inventory import verify_inventory
from moeazi_agent.temporal_integrity_inventory import inventory_hash
from moeazi_agent.temporal_integrity_nonce import FixtureNonceAllocator
from moeazi_agent.temporal_integrity_registry import verify_registry
from moeazi_agent.temporal_integrity_registry import operation_spec
from moeazi_agent.temporal_integrity_contracts import TemporalScope, digest
from moeazi_agent.temporal_integrity_evaluator import evaluate, fixture_observation, frozen_manifest
from moeazi_agent.temporal_integrity_scenarios import evaluate_fixture, scenario_registry


def test_registry_and_inventory_are_closed():
    verify_registry(); verify_inventory()


def test_frozen_corpus_uses_real_evaluator():
    now = datetime.now(timezone.utc)
    results = [evaluate_fixture(item["id"], "observe", now, "operator", "a" * 64)
        for item in scenario_registry()]
    assert results and all(item["invariantVerdict"] == "pass" for item in results)
    assert all(item["productOutcome"] == "unavailable" for item in results)


def test_nonce_retry_and_terminal_nonreuse():
    allocator = FixtureNonceAllocator()
    first = allocator.reserve("fixture-hyperliquid", "a" * 16, "account:fixture", "submit", "b" * 64, "nonce:test")
    assert allocator.reserve("fixture-hyperliquid", "a" * 16, "account:fixture", "submit", "b" * 64, "nonce:test") == first
    assert allocator.transition(first, "possibly_submitted").state == "possibly_submitted"
    with pytest.raises(RuntimeError): allocator.transition(first, "reserved")
    with pytest.raises(RuntimeError): allocator.reserve("fixture-hyperliquid", "a" * 16, "account:fixture", "submit", "c" * 64, "nonce:test")
    with pytest.raises(RuntimeError): allocator.reserve("fixture-hyperliquid", "b" * 16, "account:fixture", "submit", "b" * 64, "nonce:test")
    with pytest.raises(RuntimeError): allocator.transition(first, "confirmed")
    other_scope = allocator.reserve("fixture-hyperliquid", "c" * 16, "account:other", "submit", "d" * 64, "nonce:other")
    assert other_scope.nonce == 0


def test_temporal_evaluator_rejects_forged_spec_freshness_and_nonce_scope():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    scope = TemporalScope(key="account:fixture")
    spec = operation_spec("submit")
    observation = fixture_observation(spec, scope, int(now.timestamp() * 1_000_000), now)
    interval_body = {"domain_id": spec.domain_id, "subject_hash": "a" * 64,
        "valid_from_us": int(now.timestamp() * 1_000_000) - 1,
        "valid_until_us": int(now.timestamp() * 1_000_000) + 1_000_000}
    from moeazi_agent.temporal_integrity_contracts import CausalLink, SequencePoint, ValidityInterval
    interval = ValidityInterval(**interval_body, interval_hash=digest(interval_body))
    sequence = SequencePoint(kind="venue", epoch=spec.epoch, counter=1, event_hash="b" * 64)
    link_body = {"predecessor_hash": "c" * 64, "successor_hash": sequence.event_hash,
        "proof_kind": "native_sequence", "source_evidence_hash": "d" * 64}
    causal = CausalLink(**link_body, link_hash=digest(link_body))
    nonce = FixtureNonceAllocator().reserve(spec.domain_id, "e" * 16, "account:other", "submit", "f" * 64, "nonce:scope")
    decision = evaluate("submit", scope, spec, observation, interval, sequence, causal, nonce, now,
        "temporal:scope", "a" * 64, inventory_hash(), "b" * 64)
    assert decision.outcome == "block" and "nonce_lease_missing" in decision.reasons


def test_frozen_manifest_rejects_tampered_request_or_hash():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    scope = TemporalScope(key="account:fixture"); spec = operation_spec("prepare")
    observation = fixture_observation(spec, scope, int(now.timestamp() * 1_000_000), now)
    body = {"domain_id": spec.domain_id, "subject_hash": "a" * 64,
        "valid_from_us": int(now.timestamp() * 1_000_000) - 1,
        "valid_until_us": int(now.timestamp() * 1_000_000) + 1}
    from moeazi_agent.temporal_integrity_contracts import ValidityInterval
    interval = ValidityInterval(**body, interval_hash=digest(body))
    manifest = frozen_manifest("prepare", scope, spec, observation, interval, None, None, None,
        "temporal:manifest", "a" * 64, inventory_hash(), "b" * 64)
    with pytest.raises(ValueError):
        manifest.__class__(**manifest.model_dump(exclude={"manifest_hash"}), manifest_hash="0" * 64)
