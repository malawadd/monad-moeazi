"""Independent checks that replay assumptions and run scope stay frozen."""
from datetime import timedelta

import pytest

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.lifecycle_run_contracts import (
    SimulationFeeRule, SimulationFundingRule, SimulationOutcomeRule,
    SimulationRunManifest, SimulationScenario, simulation_dataset_hash,
)
from test_stage3_lifecycle_contracts import CONTROLLER, H, SCOPE, T, seal
from test_stage2_observation_replay import book


def scenario(**changes):
    body = dict(schema_version=1, model_version="fixture-v1", model_hash=H,
        dataset_hash=H, seed=7, clock_mode="historical_replay",
        simulation_cursor_at=T, simulation_end_at=T + timedelta(minutes=2),
        evidence_cutoff_at=T - timedelta(seconds=1), latency_ms=25,
        cancel_latency_ms=50, max_book_age_ms=5000,
        depth_participation_bps=2500, fee_bps=10,
        funding_bps=-2, protection_outcome_model="scenario_events",
        queue_model="no_queue_estimate",
        fee_rules=({"order_ordinal": 1, "fill_ordinal": 2,
                    "asset_unit_id": "ETH:18", "registry_hash": H,
                    "units": "1000000000000000"},),
        funding_rules=({"order_ordinal": 1, "source_event_id": "funding-1",
                        "instrument_version_id": "perp-v1",
                        "at_cursor": T + timedelta(minutes=1),
                        "asset_unit_id": "USDC:6", "registry_hash": H,
                        "signed_units": "-3000000"},),
        outcome_rules=({"order_ordinal": 1,
                        "source_event_id": "protection-rejected-1",
                        "kind": "protection_rejected",
                        "at_cursor": T + timedelta(minutes=1)},))
    body.update(changes)
    for field, model in (("fee_rules", SimulationFeeRule),
                         ("funding_rules", SimulationFundingRule),
                         ("outcome_rules", SimulationOutcomeRule)):
        body[field] = tuple(model.model_validate(item) if isinstance(item, dict)
                            else item for item in body[field])
    return seal(SimulationScenario, "moeazi-simulation-scenario-v1",
                "scenario_hash", body)


def manifest(**changes):
    body = dict(schema_version=1, scope=SCOPE, controller_ref=CONTROLLER,
        controller_mode="shadow", run_id="run-a", strategy_artifact_hash=H,
        policy_version="policy-v1", policy_hash=H,
        instrument_version_ids=("spot-v1", "perp-v1"),
        evidence_snapshot_hash=H, account_snapshot_hash=H,
        scenario=scenario())
    return seal(SimulationRunManifest, "moeazi-simulation-run-v1",
                "manifest_hash", body | changes)


def test_same_seed_and_assumptions_are_hash_stable_but_changed_seed_is_distinct():
    first = scenario()
    assert first.scenario_hash == scenario().scenario_hash
    assert first.scenario_hash != scenario(seed=8).scenario_hash
    assert manifest().manifest_hash == manifest().manifest_hash
    assert manifest(scenario=scenario(seed=8)).manifest_hash != \
        manifest().manifest_hash


@pytest.mark.parametrize("changed", [
    {"schema_version": True},
    {"simulation_cursor_at": T - timedelta(seconds=2)},
    {"simulation_end_at": T - timedelta(seconds=1)},
    {"seed": -1},
    {"fee_rules": ({"order_ordinal": 1, "fill_ordinal": 2,
                    "asset_unit_id": "ETH:18", "registry_hash": H,
                    "units": "1000000000000000"},) * 2},
    {"funding_rules": ({"order_ordinal": 1, "source_event_id": "funding-1",
                        "instrument_version_id": "perp-v1",
                        "at_cursor": T + timedelta(minutes=3),
                        "asset_unit_id": "USDC:6", "registry_hash": H,
                        "signed_units": "-3000000"},)},
    {"funding_rules": ({"order_ordinal": 1, "source_event_id": "zero-payment",
                        "instrument_version_id": "perp-v1",
                        "at_cursor": T + timedelta(minutes=1),
                        "asset_unit_id": "USDC:6", "registry_hash": H,
                        "signed_units": "0"},)},
    {"outcome_rules": ({"order_ordinal": 1,
                        "source_event_id": "same", "kind": "rejected",
                        "at_cursor": T},
                       {"order_ordinal": 1,
                        "source_event_id": "same", "kind": "cancelled",
                        "at_cursor": T})},
])
def test_scenario_rejects_invalid_clock_or_duplicate_source_facts(changed):
    with pytest.raises(ValueError):
        scenario(**changed)


@pytest.mark.parametrize("changed", [
    {"scope": FinanceScope(environment="live", scope_id="live",
                           strategy_account_id="account-a")},
    {"controller_ref": ControllerRef(schemaVersion=1,
        environment="experiment", strategyAccountId="account-b",
        controllerKind="customer_team", controllerId="spec-a",
        controllerVersionId="version-a", contentHash=H)},
    {"instrument_version_ids": ("spot-v1", "spot-v1")},
    {"instrument_version_ids": ()},
])
def test_manifest_rejects_live_cross_account_and_ambiguous_instruments(changed):
    with pytest.raises(ValueError):
        manifest(**changed)


def test_rehashed_fee_and_funding_change_assumptions_not_prior_manifest():
    first = manifest()
    changed = scenario(funding_bps=0)
    assert first.scenario.scenario_hash != changed.scenario_hash
    assert first.manifest_hash != manifest(scenario=changed).manifest_hash
    with pytest.raises(ValueError):
        SimulationRunManifest.model_validate(first.model_dump() |
            {"scenario": changed.model_dump()})


def test_dataset_hash_binds_ordered_normalized_observation_not_raw_hash_alone():
    first, second = book(event_id="a"), book(event_id="b")
    frozen = simulation_dataset_hash((first, second))
    assert frozen == simulation_dataset_hash((first, second))
    assert frozen != simulation_dataset_hash((second, first))
    changed_time = book(event_id="a", event_at=first.event_at - timedelta(seconds=1))
    assert changed_time.raw_payload_hash == first.raw_payload_hash
    assert frozen != simulation_dataset_hash((changed_time, second))
    with pytest.raises(ValueError):
        simulation_dataset_hash((first, first))
    with pytest.raises(ValueError):
        simulation_dataset_hash(())
