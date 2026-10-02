from datetime import datetime, timezone

import pytest

from moeazi_agent.instrument_lifecycle_contracts import NativeInstrumentIdentity, RegistryScope, digest
from moeazi_agent.instrument_lifecycle_evaluator import evaluate
from moeazi_agent.instrument_lifecycle_registry import raw, verify_registry
from moeazi_agent.instrument_lifecycle_scenarios import evaluate_fixture, scenario_registry
from moeazi_agent.instrument_lifecycle_events import fold


def test_registry_and_adversarial_corpus_are_closed():
    verify_registry(); now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    results = [evaluate_fixture(item["id"], "observe", now, "operator", "a" * 64) for item in scenario_registry()]
    assert results and all(item["invariantVerdict"] == "pass" for item in results)
    assert all(item["productOutcome"] == "unavailable" for item in results)


def test_exact_identity_hash_rejects_universe_mutation():
    item = raw()["identities"][0]
    assert NativeInstrumentIdentity.model_validate(item).identity_hash == item["identity_hash"]
    with pytest.raises(ValueError): NativeInstrumentIdentity.model_validate({**item, "universe_revision": "hl-u2"})


def test_no_symbol_only_exposure_and_safe_lanes_remain_independent():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    blocked = evaluate_fixture("same-symbol-venues-block", "enforce", now, "operator", "b" * 64)
    allowed = evaluate_fixture("halted-reduce-allow", "enforce", now, "operator", "c" * 64)
    assert blocked["actualOutcome"] == "block"
    assert allowed["actualOutcome"] == "allow"


def test_exact_identity_scope_and_effective_interval_are_required_for_safe_lanes():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    identity = NativeInstrumentIdentity.model_validate(raw()["identities"][0])
    scope = RegistryScope(tenant_id="tenant:fixture", venue="gmx", environment="arbitrum-mainnet", namespace="gmx_v2")
    decision = evaluate("reconcile", scope, "caller-snapshot", identity, None, [], [], [], now,
        "instrument:scope", "caller-request")
    assert decision.outcome == "unknown"
    assert "identity_scope_mismatch" in decision.reasons
    assert decision.snapshot_hash != "caller-snapshot" and decision.request_hash != "caller-request"


def test_registry_rejects_duplicate_or_incomplete_asset_roles():
    item = raw()["definitions"][0]
    from moeazi_agent.instrument_lifecycle_contracts import InstrumentDefinitionVersion
    invalid = {**item, "asset_roles": [item["asset_roles"][0], item["asset_roles"][0], item["asset_roles"][2]]}
    with pytest.raises(ValueError): InstrumentDefinitionVersion.model_validate(invalid)


def test_lifecycle_event_references_and_safe_lanes_fail_closed():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    identity = NativeInstrumentIdentity.model_validate(raw()["identities"][0])
    scope = RegistryScope(tenant_id="tenant:fixture", venue="hyperliquid",
        environment="hyperliquid-mainnet", namespace="hl_perp")
    decision = evaluate("reconcile", scope, "a" * 64, identity, None, [], [], [], now,
        "instrument:event", "b" * 64)
    assert decision.outcome == "unknown" and decision.permitted_lanes == []


def test_conflicting_native_sequence_is_disputed_even_when_arrival_order_changes():
    from moeazi_agent.instrument_lifecycle_contracts import InstrumentLifecycleEvent
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    scope = RegistryScope(tenant_id="tenant:fixture", venue="hyperliquid",
        environment="hyperliquid-mainnet", namespace="hl_perp")
    rows = []
    for event_id in ("event:one", "event:two"):
        body = {"event_id": event_id, "scope": scope, "native_sequence": 4,
            "event_type": "rename", "effective_at": now, "observed_at": now,
            "source_evidence_hash": "a" * 64, "supersedes_event_hash": None}
        hashed = {**body, "old_definition_hash": None, "new_definition_hash": None}
        rows.append(InstrumentLifecycleEvent(**body, event_hash=digest(hashed)))
    ordered, reasons, watermark = fold(list(reversed(rows)))
    assert len(ordered) == 1 and watermark == 4 and "native_sequence_conflict" in reasons
