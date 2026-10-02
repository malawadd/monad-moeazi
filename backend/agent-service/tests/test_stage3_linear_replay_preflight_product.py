"""Exact linear-perpetual preflight stays inside immutable held capacity."""
from datetime import timedelta
import json

import pytest

from moeazi_agent.finance_contracts import _digest
from moeazi_agent.lifecycle_order_replay_preflight import verify_linear_replay_preflight
from moeazi_agent.lifecycle_position_math import empty_position_state
from moeazi_agent.lifecycle_replay_finance_contracts import ReplaySizingReceipt
from moeazi_agent.lifecycle_simulator import simulate_order
from test_stage2_observation_replay import NOW
from test_stage3_lifecycle_contracts import permit
from test_stage3_replay_sizing_product import perp_case
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt


def _case():
    run, decision, policy, instrument, book, evidence, dataset, snapshot, positions = \
        perp_case()
    receipt = build_replay_sizing_receipt(run, decision, policy, instrument,
        book, evidence, dataset, snapshot, positions, (), request_id="linear-open",
        action="perp_open", side="buy", desired_quantity_units="10",
        order_ordinal=1, account_revision=1)
    request = permit(scope=run.scope, controller_ref=run.controller_ref,
        run_id=run.run_id, run_manifest_hash=run.manifest_hash,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash,
        action="perp_open", side="buy", quantity_kind="contracts",
        contract_size_unit_id=receipt.contract_size_unit_id,
        contract_size_units=receipt.contract_size_units,
        quantity_asset_unit_id=receipt.base_asset_unit_id,
        quantity_registry_hash=receipt.base_registry_hash,
        quote_asset_unit_id=receipt.quote_asset_unit_id,
        quote_registry_hash=receipt.quote_registry_hash,
        settlement_asset_unit_id=receipt.settlement_asset_unit_id,
        settlement_registry_hash=receipt.settlement_registry_hash,
        quantity_units=receipt.quantity_units, location_id=receipt.location_id,
        policy_hash=receipt.policy_hash,
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        decision_context_hash=decision.decision_hash,
        issued_at_cursor=NOW, valid_until_cursor=NOW + timedelta(seconds=2))
    events = simulate_order(request, instrument, dataset, run.scenario, decision)
    return run, policy, instrument, receipt, request, events


def test_linear_open_worst_modeled_margin_and_fee_fit_exact_hold():
    run, policy, instrument, receipt, request, events = _case()
    assert [row.kind for row in events] == ["accepted", "fill"]
    verify_linear_replay_preflight(receipt, run, request, instrument,
        policy.initial_margin_bps, empty_position_state(request, instrument), events)


def test_linear_open_refuses_underheld_margin_or_fee_before_submission():
    run, policy, instrument, receipt, request, events = _case()
    body = receipt.model_dump(mode="json", exclude={"receipt_hash"})
    body["components"][0]["units"] = "1"
    body["receipt_hash"] = _digest("moeazi-replay-sizing-v1", body)
    underheld = ReplaySizingReceipt.model_validate_json(json.dumps(body))
    with pytest.raises(ValueError, match="exact held capacity"):
        verify_linear_replay_preflight(underheld, run, request, instrument,
            policy.initial_margin_bps, empty_position_state(request, instrument), events)
