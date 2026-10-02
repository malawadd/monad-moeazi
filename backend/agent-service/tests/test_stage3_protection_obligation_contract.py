"""Independent pure source binding for one immediate protective obligation per fill."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_contracts import ProtectionRequirement, TradeIntent
from moeazi_agent.lifecycle_position_math import calculate_fill_effect, empty_position_state
from moeazi_agent.lifecycle_position_math_contracts import PositionArithmeticState
from moeazi_agent.lifecycle_protection_contracts import make_protection_obligation
from test_stage2_observation_replay import instrument
from test_stage3_lifecycle_contracts import CONTROLLER, H, SCOPE, T, event, permit, seal


def _source():
    definition = instrument()
    protection = ProtectionRequirement(required=True, policy_version="policy-v1",
        policy_hash=H, maximum_unprotected_seconds=5,
        on_rejection="hold_and_escalate")
    intent = seal(TradeIntent, "moeazi-trade-intent-v1", "intent_hash", dict(
        schema_version=1, scope=SCOPE, controller_ref=CONTROLLER,
        controller_mode="shadow", run_id="run-a", run_manifest_hash=H,
        intent_id="intent-a", strategy_artifact_hash=H,
        instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        action="spot_buy", side="buy", target_exposure_units="10000000",
        desired_quantity_units="10000000", horizon_seconds=60,
        evidence_snapshot_hash=H, calculation_receipt_hash=H,
        supplied_claim_ids=(), verified_claim_receipt_hashes=(),
        rationale_summary="Frozen accepted replay book",
        invalidation_rule_hash=H, expires_at_cursor=T + timedelta(minutes=1),
        protection=protection))
    submitted = permit(intent_hash=intent.intent_hash,
        instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id)
    fill = event(instrument_version_id=definition.instrument_version_id,
                 permit_hash=submitted.permit_hash)
    effect = calculate_fill_effect(empty_position_state(submitted, definition),
                                   submitted, fill, definition, margin_bps=0)
    return fill, submitted, definition, effect.new_state, intent


def test_actual_increasing_fill_seals_distinct_bounded_protection_preimage():
    fill, submitted, definition, state, intent = _source()
    first = make_protection_obligation(fill, submitted, definition, state, intent, 1)
    assert first == make_protection_obligation(fill, submitted, definition, state, intent, 1)
    assert first.originating_event_hash == fill.event_hash
    assert first.originating_permit_hash == submitted.permit_hash
    assert first.filled_quantity_units == "10000000"
    assert first.signed_exposure_units == "10000000"
    assert first.mechanism == "immediate_reduce_only_market"
    assert first.deadline_at_cursor == fill.simulation_cursor_at + timedelta(seconds=5)
    assert first.on_rejection == "hold_and_escalate"


def test_fill_bound_protection_rejects_valid_but_foreign_registry_state():
    fill, submitted, definition, state, intent = _source()
    foreign = PositionArithmeticState.model_validate(state.model_dump() | {
        "instrument_registry_hash": "b" * 64})
    with pytest.raises(ValueError, match="registry|source|instrument"):
        make_protection_obligation(fill, submitted, definition, foreign, intent, 1)


def test_protective_obligation_refuses_nonfill_or_foreign_permit():
    fill, submitted, definition, state, intent = _source()
    different = permit(intent_hash=intent.intent_hash,
        instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id,
        client_id="different-client")
    with pytest.raises(ValueError, match="source|fill"):
        make_protection_obligation(fill, different, definition, state, intent, 1)
