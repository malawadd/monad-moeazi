"""Validate a causal order against immutable pre-dispatch evidence."""
from __future__ import annotations

from datetime import timedelta
from fractions import Fraction

from .finance_contracts import FinanceError, native_int
from .lifecycle_contracts import ExecutionPermit
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION, ExecutionEnvelopeV1
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_simulator import CAUSAL_MODEL_HASH
from .observation_contracts import InstrumentVersion, MarketObservation, canonical_hash


def native_ratio(value: str, instrument: InstrumentVersion) -> Fraction:
    return Fraction(value) * 10 ** instrument.quote_decimals / \
        10 ** instrument.base_decimals


def validate_causal_corpus(manifest: SimulationRunManifest,
        instruments: dict[str, InstrumentVersion],
        observations: tuple[MarketObservation, ...]) -> None:
    scenario = manifest.scenario
    if scenario.model_version != CAUSAL_MODEL_VERSION or \
            scenario.model_hash != CAUSAL_MODEL_HASH or \
            scenario.queue_model != "no_queue_estimate":
        raise FinanceError("causal replay model is not qualified")
    if scenario.funding_rules or scenario.outcome_rules:
        raise FinanceError("causal scheduled funding/outcomes need retained source support")
    if set(instruments) != set(manifest.instrument_version_ids):
        raise FinanceError("causal instrument registry differs from frozen run")
    rights = {"recorded_native": "internal_qualification_only",
              "synthetic_fault": "local_simulation_fixture_only",
              "documented_example": "documentation_example_only"}
    for row in observations:
        instrument = instruments.get(row.instrument_version_id)
        if instrument is None or row.source_id != instrument.venue_id or \
                row.source_rights_ref != rights[row.source_kind] or \
                row.finality not in {"not_applicable", "confirmed"} or \
                row.event_at > row.available_at or \
                row.available_at > row.received_at or \
                instrument.effective_at > row.event_at:
            raise FinanceError("causal corpus has inadmissible source identity")
        bids = tuple(Fraction(level.price_quote_per_base) for level in row.bids)
        asks = tuple(Fraction(level.price_quote_per_base) for level in row.asks)
        if not bids or not asks or bids[0] >= asks[0] or \
                any(left <= right for left, right in zip(bids, bids[1:])) or \
                any(left >= right for left, right in zip(asks, asks[1:])) or \
                any(Fraction(level.size_base) % Fraction(instrument.lot_step)
                    for level in (*row.bids, *row.asks)):
            raise FinanceError("causal corpus has an invalid visible book")


def validate_causal_permit(manifest: SimulationRunManifest,
        permit: ExecutionPermit, instrument: InstrumentVersion,
        observations: tuple[MarketObservation, ...],
        context: ReplayDecisionContext) -> ExecutionEnvelopeV1:
    scenario = manifest.scenario
    envelope = permit.execution_envelope
    if envelope is None or envelope.model_version != CAUSAL_MODEL_VERSION or \
            permit.scope != manifest.scope or permit.run_id != manifest.run_id or \
            permit.run_manifest_hash != manifest.manifest_hash or \
            permit.controller_ref != manifest.controller_ref or \
            permit.controller_mode != manifest.controller_mode or \
            permit.policy_hash != manifest.policy_hash or \
            permit.instrument_version_id != instrument.instrument_version_id or \
            permit.instrument_registry_hash != instrument.registry_hash or \
            permit.quantity_asset_unit_id != instrument.base_asset_unit_id or \
            permit.quote_asset_unit_id != instrument.quote_asset_unit_id or \
            permit.settlement_asset_unit_id != instrument.settlement_asset_unit_id or \
            permit.decision_context_hash != context.decision_hash or \
            context.evidence_snapshot_hash != permit.evidence_snapshot_hash or \
            envelope.decision_hash != context.decision_hash or \
            envelope.issued_at_cursor != context.cursor_at or \
            envelope.account_snapshot_hash != context.account_snapshot_hash:
        raise FinanceError("causal permit lacks exact run and decision identity")
    if permit.issued_at_cursor > permit.valid_until_cursor or \
            envelope.accepted_at_cursor != permit.issued_at_cursor + \
                timedelta(milliseconds=scenario.latency_ms) or \
            not scenario.simulation_cursor_at <= permit.issued_at_cursor or \
            envelope.time_in_force_cursor > scenario.simulation_end_at:
        raise FinanceError("causal accepted time is outside frozen dispatch clock")
    end = scenario.simulation_end_at
    if permit.action in {"spot_buy", "perp_open", "perp_increase"}:
        if manifest.protection_policy is None:
            raise FinanceError("causal increase has no bounded protection policy")
        end -= timedelta(seconds=manifest.protection_policy.maximum_unprotected_seconds)
    expected_tif = min(envelope.accepted_at_cursor + timedelta(
        milliseconds=scenario.order_time_in_force_ms or 0), end)
    if envelope.time_in_force_cursor != expected_tif or \
            envelope.max_fill_events != scenario.max_fill_events_per_order:
        raise FinanceError("causal TIF or fill count differs from frozen scenario")
    selected = max((row for row in observations if
        row.instrument_version_id == instrument.instrument_version_id and
        row.available_at <= context.evidence_cutoff_at),
        key=lambda row: (row.available_at, row.event_at, row.source_id,
                         row.source_event_id), default=None)
    if selected is None or canonical_hash(selected.model_dump(mode="json")) != \
            envelope.selected_observation_hash or \
            selected.available_at > permit.issued_at_cursor or \
            (envelope.accepted_at_cursor - selected.event_at).total_seconds() * 1000 > \
                scenario.max_book_age_ms:
        raise FinanceError("causal selected book is not known and fresh at issue")
    deviation = scenario.max_execution_deviation_bps
    if deviation is None:
        raise FinanceError("causal price deviation is not declared")
    ask = native_ratio(selected.asks[0].price_quote_per_base, instrument)
    bid = native_ratio(selected.bids[0].price_quote_per_base, instrument)
    expected_price = (ask * (10_000 + deviation) / 10_000 if
                      permit.side == "buy" else bid * (10_000 - deviation) / 10_000)
    limit = Fraction(native_int(envelope.limit_price_numerator, positive=True),
                     native_int(envelope.limit_price_denominator, positive=True))
    if limit != expected_price:
        raise FinanceError("causal price limit differs from known decision book")
    if permit.quantity_kind == "contracts":
        size = Fraction(instrument.contract_multiplier) * 10 ** instrument.base_decimals
        if instrument.product_kind != "perpetual" or \
                instrument.margin_model != "linear_v1" or size.denominator != 1 or \
                permit.contract_size_units != str(size.numerator) or \
                permit.contract_size_unit_id != instrument.base_asset_unit_id:
            raise FinanceError("causal perpetual lacks linear contract identity")
    elif instrument.product_kind != "spot":
        raise FinanceError("causal asset-native order needs a spot instrument")
    return envelope
