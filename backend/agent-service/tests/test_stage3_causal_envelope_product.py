"""Causal Q4 sizing uses the same known prefix across divergent futures."""
from datetime import timedelta

from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_execution_envelope import (
    CAUSAL_MODEL_VERSION, ExecutionEnvelopeV1,
)
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_run_contracts import (
    ExperimentProtectionPolicyV1, simulation_dataset_hash,
)
from moeazi_agent.lifecycle_simulator import CAUSAL_MODEL_HASH
from moeazi_agent.observation_contracts import BookLevel
from test_stage2_observation_replay import NOW
from test_stage3_lifecycle_contracts import seal
from test_stage3_replay_sizing_product import case
from test_stage3_run_contracts import manifest, scenario
from test_stage3_strategy_signal_boundary import admitted


def _policy():
    return seal(ExperimentProtectionPolicyV1,
        "moeazi-experiment-protection-policy-v1", "policy_hash",
        dict(schema_version=1,
             policy_version="bounded-historical-unprotected-v1",
             maximum_unprotected_seconds=1,
             allow_increases_before_deadline=True,
             deadline_action="stop_and_escalate"))


def _case(future_ask: str, *, action="spot_buy", side="buy", base_units="0"):
    old_run, _, policy, instrument, known, evidence, _, snapshot = case(
        include_eth=False, base_units=base_units)
    future = admitted(event_id=f"future-{future_ask}",
        event_at=NOW + timedelta(milliseconds=300),
        available_at=NOW + timedelta(milliseconds=300),
        received_at=NOW + timedelta(milliseconds=300),
        bids=(BookLevel(price_quote_per_base=str(int(future_ask) - 1),
                        size_base="0.01"),),
        asks=(BookLevel(price_quote_per_base=future_ask,
                        size_base="0.02"),))
    dataset = (known, future)
    source = scenario(model_version=CAUSAL_MODEL_VERSION,
        model_hash=CAUSAL_MODEL_HASH, dataset_hash=simulation_dataset_hash(dataset),
        simulation_cursor_at=NOW, simulation_end_at=NOW + timedelta(seconds=2),
        evidence_cutoff_at=NOW, fee_rules=(), funding_rules=(), outcome_rules=(),
        max_execution_deviation_bps=500, order_time_in_force_ms=500,
        max_fill_events_per_order=4)
    run = manifest(scope=old_run.scope, controller_ref=old_run.controller_ref,
        scenario=source, instrument_version_ids=(instrument.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=policy.policy_hash, policy_version=policy.policy_version,
        protection_policy=_policy())
    decision, selected = build_replay_decision(run, dataset, NOW, evidence,
        instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    receipt = build_replay_sizing_receipt(run, decision, policy, instrument,
        selected, evidence, dataset, snapshot, (), (), request_id="causal-buy",
        action=action, side=side, desired_quantity_units="10000000",
        order_ordinal=1, account_revision=1)
    return run, instrument, dataset, decision, receipt


def _sizing(future_ask: str):
    return _case(future_ask)[-1]


def test_divergent_future_books_leave_current_economic_envelope_identical():
    cheaper = _sizing("22000")
    dearer = _sizing("35000")
    assert cheaper.code_version == dearer.code_version == "replay-sizing-v2"
    first = cheaper.execution_envelope
    second = dearer.execution_envelope
    assert isinstance(first, ExecutionEnvelopeV1)
    assert isinstance(second, ExecutionEnvelopeV1)
    assert (cheaper.quantity_units, cheaper.price_numerator,
            cheaper.price_denominator, cheaper.notional_units,
            cheaper.risk_notional_units, cheaper.components) == (
            dearer.quantity_units, dearer.price_numerator,
            dearer.price_denominator, dearer.notional_units,
            dearer.risk_notional_units, dearer.components)
    assert (first.limit_price_numerator, first.limit_price_denominator,
            first.time_in_force_cursor, first.liabilities) == (
            second.limit_price_numerator, second.limit_price_denominator,
            second.time_in_force_cursor, second.liabilities)
    assert cheaper.receipt_hash != dearer.receipt_hash  # Frozen datasets differ.
