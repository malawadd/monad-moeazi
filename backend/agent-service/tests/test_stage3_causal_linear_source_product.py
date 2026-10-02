"""A linear close replays from its frozen, exact prior source position."""
from datetime import timedelta
from fractions import Fraction

import pytest

from moeazi_agent.finance_contracts import _digest
from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_execution_envelope import (
    CAUSAL_MODEL_VERSION, ExecutionEnvelopeV1,
)
from moeazi_agent.lifecycle_position_math import (
    calculate_fill_effect, empty_position_state,
)
from moeazi_agent.lifecycle_replay import simulate_run
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import CAUSAL_MODEL_HASH
from moeazi_agent.lifecycle_simulator_causal_inputs import native_ratio
from test_stage2_observation_replay import NOW
from test_stage3_causal_envelope_product import _policy
from test_stage3_lifecycle_contracts import permit
from test_stage3_replay_sizing_oracle import _frozen
from test_stage3_run_contracts import manifest, scenario


def _pair(value: Fraction) -> tuple[str, str]:
    return str(value.numerator), str(value.denominator)


def _seal_envelope(source: ExecutionEnvelopeV1, **updates) -> ExecutionEnvelopeV1:
    body = {name: getattr(source, name) for name in type(source).model_fields
            if name != "envelope_hash"} | updates
    encoded = ExecutionEnvelopeV1.model_construct(**body).model_dump(
        mode="json", exclude={"envelope_hash"})
    return ExecutionEnvelopeV1.model_validate(body | {
        "envelope_hash": _digest("moeazi-execution-envelope-v1", encoded)})


def _order(run, definition, decision, envelope, ordinal, action, side):
    return permit(scope=run.scope, controller_ref=run.controller_ref,
        controller_mode=run.controller_mode, run_id=run.run_id,
        run_manifest_hash=run.manifest_hash, policy_hash=run.policy_hash,
        order_id=f"causal-perp-{ordinal}", order_ordinal=ordinal,
        client_id=f"causal-client-{ordinal}",
        attempt_id=f"causal-attempt-{ordinal}",
        instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        action=action, side=side, quantity_kind="contracts",
        contract_size_unit_id=definition.base_asset_unit_id,
        contract_size_units="1000000",
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id,
        quantity_units="1", location_id="venue",
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        decision_context_hash=decision.decision_hash,
        issued_at_cursor=decision.cursor_at,
        valid_until_cursor=decision.cursor_at + timedelta(milliseconds=50),
        execution_envelope=envelope)


def _case():
    _, _, policy, definition, book, evidence, dataset, snapshot, _ = _frozen(
        perpetual=True)
    frozen = scenario(model_version=CAUSAL_MODEL_VERSION,
        model_hash=CAUSAL_MODEL_HASH,
        dataset_hash=simulation_dataset_hash(dataset),
        evidence_cutoff_at=NOW, simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        fee_rules=(), funding_rules=(), outcome_rules=(),
        depth_participation_bps=10_000,
        max_execution_deviation_bps=500, order_time_in_force_ms=500,
        max_fill_events_per_order=4)
    run = manifest(scenario=frozen,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=policy.policy_hash, policy_version=policy.policy_version,
        protection_policy=_policy())
    decision, selected = build_replay_decision(run, dataset, NOW, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    receipt = build_replay_sizing_receipt(run, decision, policy, definition,
        selected, evidence, dataset, snapshot, (), (), request_id="linear-open",
        action="perp_open", side="buy", desired_quantity_units="1",
        order_ordinal=1, account_revision=7)
    opening = _order(run, definition, decision, receipt.execution_envelope,
                     1, "perp_open", "buy")
    prefix = simulate_run(run, (opening,), (definition,), dataset,
        {opening.order_id: decision}, margin_bps=policy.initial_margin_bps)
    fill = next(row for row in prefix if row.kind == "fill")
    state = calculate_fill_effect(empty_position_state(opening, definition),
        opening, fill, definition,
        margin_bps=policy.initial_margin_bps).new_state
    later = NOW + timedelta(milliseconds=100)
    close_decision, _ = build_replay_decision(run, dataset, later, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    limit = native_ratio(book.bids[0].price_quote_per_base, definition) * \
        Fraction(9500, 10_000)
    anchor_hash = _digest("moeazi-position-arithmetic-v1",
                          state.model_dump(mode="json"))
    closing_envelope = _seal_envelope(receipt.execution_envelope,
        decision_hash=close_decision.decision_hash,
        action="perp_close", side="sell", issued_at_cursor=later,
        accepted_at_cursor=later + timedelta(milliseconds=frozen.latency_ms),
        time_in_force_cursor=later + timedelta(milliseconds=
            frozen.latency_ms + 500),
        limit_price_numerator=_pair(limit)[0],
        limit_price_denominator=_pair(limit)[1],
        max_collateral_loss_units=state.collateral_units,
        position_state_hash=anchor_hash, position_revision=1)
    closing = _order(run, definition, close_decision, closing_envelope,
                     2, "perp_close", "sell")
    return (run, definition, dataset, decision, close_decision, opening,
            closing, state, policy.initial_margin_bps)


def test_linear_close_uses_prior_source_basis_and_does_not_overclose():
    run, definition, dataset, first, second, opening, closing, state, margin = _case()
    events = simulate_run(run, (opening, closing), (definition,), dataset,
        {opening.order_id: first, closing.order_id: second},
        position_anchors={closing.order_id: state}, margin_bps=margin)
    assert [(item.order_id, item.kind) for item in events if item.kind == "fill"] == [
        (opening.order_id, "fill"), (closing.order_id, "fill")]
    with pytest.raises(ValueError, match="anchor differs"):
        simulate_run(run, (opening, closing), (definition,), dataset,
            {opening.order_id: first, closing.order_id: second},
            position_anchors={closing.order_id: state.model_copy(update={
                "open_cost_numerator": "1"})}, margin_bps=margin)


def test_linear_loss_outside_frozen_collateral_limit_retains_open_prefix():
    run, definition, dataset, first, second, opening, closing, state, margin = _case()
    limited = _order(run, definition, second, _seal_envelope(
        closing.execution_envelope, max_collateral_loss_units="0"),
        2, "perp_close", "sell")
    events = simulate_run(run, (opening, limited), (definition,), dataset,
        {opening.order_id: first, limited.order_id: second},
        position_anchors={limited.order_id: state}, margin_bps=margin)
    assert [item.order_id for item in events if item.kind == "fill"] == [
        opening.order_id]
    assert events[-1].order_id == limited.order_id
    assert (events[-1].kind, events[-1].terminal_reason) == (
        "cancelled", "envelope_exhausted")
