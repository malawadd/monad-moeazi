"""Independent historical-policy wire and hash compatibility checks."""
import json
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_run_contracts import ExperimentProtectionPolicyV1
from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_order_replay_preflight import preflight_replay_order
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_run_contracts import SimulationRunManifest
from test_stage2_observation_replay import NOW
from test_stage3_lifecycle_contracts import H, event, permit, seal
from test_stage3_replay_sizing_product import case
from test_stage3_run_contracts import manifest


LEGACY_MANIFEST_HASH = "4a98f5ad5f43b28883400d1dae4cc91e9b640dc0b2a075d567d9bb6f7828b786"


def policy(**changes):
    body = dict(schema_version=1,
        policy_version="bounded-historical-unprotected-v1",
        maximum_unprotected_seconds=30,
        allow_increases_before_deadline=False,
        deadline_action="stop_and_escalate") | changes
    return seal(ExperimentProtectionPolicyV1,
        "moeazi-experiment-protection-policy-v1", "policy_hash", body)


def test_absent_policy_keeps_exact_legacy_manifest_json_and_hash():
    baseline = manifest()
    explicit_none = manifest(protection_policy=None)
    assert baseline.manifest_hash == LEGACY_MANIFEST_HASH
    assert baseline == explicit_none
    assert baseline.model_dump(mode="json") == explicit_none.model_dump(mode="json")
    assert "protection_policy" not in baseline.model_dump(mode="json")
    assert "protection_policy" not in json.loads(baseline.model_dump_json())


def test_explicit_policy_is_hash_bound_and_changes_manifest_identity():
    baseline = manifest()
    strict = policy()
    permissive = policy(allow_increases_before_deadline=True)
    assert strict.policy_hash != permissive.policy_hash
    first = manifest(protection_policy=strict)
    second = manifest(protection_policy=permissive)
    assert first.manifest_hash != baseline.manifest_hash
    assert second.manifest_hash != first.manifest_hash
    assert first.model_dump(mode="json")["protection_policy"]["policy_hash"] == \
        strict.policy_hash
    with pytest.raises(ValueError, match="hash"):
        ExperimentProtectionPolicyV1.model_validate(strict.model_dump() | {
            "maximum_unprotected_seconds": 31})


@pytest.mark.parametrize("changed", [
    {"schema_version": True},
    {"schema_version": 1.0},
    {"maximum_unprotected_seconds": True},
    {"maximum_unprotected_seconds": 30.0},
    {"maximum_unprotected_seconds": 0},
    {"maximum_unprotected_seconds": 3601},
    {"allow_increases_before_deadline": 1},
    {"allow_increases_before_deadline": "false"},
    {"deadline_action": "ignore"},
    {"policy_hash": H},
])
def test_policy_rejects_coercion_bounds_and_arbitrary_hash(changed):
    body = policy().model_dump(mode="python") | changed
    with pytest.raises(ValueError):
        ExperimentProtectionPolicyV1.model_validate(body)


def test_deadline_cannot_exceed_frozen_scenario_horizon():
    with pytest.raises(ValueError, match="deadline exceeds replay horizon"):
        manifest(protection_policy=policy(maximum_unprotected_seconds=121))


@pytest.mark.asyncio
async def test_late_modeled_partial_fill_cannot_outlive_frozen_protection_horizon():
    old, _, approved, definition, book, evidence, dataset, snapshot = case()
    protection = policy(maximum_unprotected_seconds=1)
    run = seal(SimulationRunManifest, "moeazi-simulation-run-v1", "manifest_hash",
        old.model_dump(mode="python", exclude={"manifest_hash"}) | {
            "scope": old.scope, "controller_ref": old.controller_ref,
            "scenario": old.scenario, "protection_policy": protection})
    decision, selected = build_replay_decision(run, dataset, NOW, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    receipt = build_replay_sizing_receipt(run, decision, approved, definition,
        selected, evidence, dataset, snapshot, (), (), request_id="late-fill",
        action="spot_buy", side="buy", desired_quantity_units="10000000",
        order_ordinal=1, account_revision=1)
    request = permit(run_manifest_hash=run.manifest_hash,
        instrument_version_id=receipt.instrument_version_id,
        instrument_registry_hash=receipt.instrument_registry_hash,
        action="spot_buy", side="buy", quantity_units=receipt.quantity_units,
        location_id=receipt.location_id, issued_at_cursor=NOW,
        valid_until_cursor=run.scenario.simulation_end_at)
    common = dict(scope=run.scope, run_id=run.run_id,
        run_manifest_hash=run.manifest_hash,
        instrument_version_id=receipt.instrument_version_id,
        fill_quantity_units="1000000", cumulative_filled_units="1000000",
        price_numerator=receipt.price_numerator,
        price_denominator=receipt.price_denominator, fee_units="1000000",
        fee_asset_unit_id=receipt.quote_asset_unit_id,
        fee_registry_hash=receipt.quote_registry_hash)
    early = event(**common,
        simulation_cursor_at=run.scenario.simulation_end_at -
            timedelta(milliseconds=1500))
    late = event(**common,
        simulation_cursor_at=run.scenario.simulation_end_at -
            timedelta(milliseconds=500))
    await preflight_replay_order(None, None, {}, receipt, run, request, (early,))
    with pytest.raises(ValueError, match="no in-horizon protection deadline"):
        await preflight_replay_order(None, None, {}, receipt, run, request, (late,))
