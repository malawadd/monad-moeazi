"""Pure simulated event economics; PostgreSQL remains the journal authority."""
from __future__ import annotations

from collections import defaultdict

from .finance_contracts import (
    FinanceError, JournalCommand, JournalPosting, native_int,
    semantic_request_hash, source_event_digest,
)
from .finance_oracle import balanced_postings
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .lifecycle_position_math import calculate_fill_effect, calculate_funding_effect
from .lifecycle_position_math_contracts import FillEffect, PositionArithmeticState
from .observation_contracts import InstrumentVersion

PostingKey = tuple[str, str, str, str]


def _postings(effect: FillEffect, event: ExecutionEvent,
              state: PositionArithmeticState) -> tuple[JournalPosting, ...]:
    amounts: dict[PostingKey, int] = defaultdict(int)
    if event.kind == "funding":
        amount = native_int(event.funding_units or "0")
        if amount == 0 or len(effect.deltas) != 1:
            raise FinanceError("zero or ambiguous funding cannot enter the journal")
        delta = effect.deltas[0]
        if delta.book != "collateral" or native_int(delta.units) != amount or \
                delta.asset_unit_id != event.funding_asset_unit_id or \
                delta.registry_hash != event.funding_registry_hash or \
                delta.location_id != state.location_id:
            raise FinanceError("funding collateral delta differs from source event")
        amounts[(delta.asset_unit_id, delta.registry_hash,
                 delta.location_id, "collateral")] += amount
        amounts[(delta.asset_unit_id, delta.registry_hash,
                 delta.location_id, "funding")] -= amount
    else:
        economics: dict[PostingKey, int] = defaultdict(int)
        for delta in effect.deltas:
            if delta.location_id != state.location_id:
                raise FinanceError("fill economic delta crosses its registered location")
            economics[(delta.asset_unit_id, delta.registry_hash,
                       delta.location_id, delta.book)] += native_int(delta.units)
        fee = native_int(event.fee_units or "0", nonnegative=True)
        if fee:
            if not event.fee_asset_unit_id or not event.fee_registry_hash:
                raise FinanceError("fill fee lacks its exact asset registry")
            fee_wallet = (event.fee_asset_unit_id, event.fee_registry_hash,
                          state.location_id, "wallet")
            economics[fee_wallet] += fee  # Separate fee from the net wallet delta.
            amounts[fee_wallet] -= fee
            amounts[(event.fee_asset_unit_id, event.fee_registry_hash,
                     state.location_id, "fees")] += fee
        for (asset, registry, location, book), units in economics.items():
            if units:
                amounts[(asset, registry, location, book)] += units
                amounts[(asset, registry, location, "external")] -= units
    postings = tuple(JournalPosting(asset_unit_id=asset, registry_hash=registry,
                    location_id=location, book=book, units=str(units))
                     for (asset, registry, location, book), units in sorted(amounts.items())
                     if units)
    balanced_postings(postings)
    return postings


def build_event_economics(event: ExecutionEvent, permit: ExecutionPermit,
                          instrument: InstrumentVersion,
                          state: PositionArithmeticState, *, margin_bps: int,
                          expected_revision: int, writer_epoch: int
                          ) -> tuple[FillEffect, JournalCommand]:
    """Map one immutable source fact to exact state delta and balanced journal input."""
    event = ExecutionEvent.model_validate_json(event.model_dump_json())
    permit = ExecutionPermit.model_validate_json(permit.model_dump_json())
    state = PositionArithmeticState.model_validate_json(state.model_dump_json())
    legacy_stream = (event.simulation_model_version != CAUSAL_MODEL_VERSION and
        permit.execution_envelope is None and event.source_stream in {
            "moeazi_simulation_v1", "moeazi_simulation_synthetic_v1"})
    causal_stream = (event.simulation_model_version == CAUSAL_MODEL_VERSION and
        permit.execution_envelope is not None and event.source_stream in {
            "moeazi_simulation_causal_v2",
            "moeazi_simulation_causal_synthetic_v2"})
    if event.kind not in {"fill", "funding"} or \
            not (legacy_stream or causal_stream) or \
            event.scope != permit.scope or event.scope != state.scope or \
            event.run_id != permit.run_id or event.run_id != state.run_id or \
            event.run_manifest_hash != permit.run_manifest_hash or \
            event.order_id != permit.order_id or \
            event.order_ordinal != permit.order_ordinal or \
            event.client_id != permit.client_id or \
            event.attempt_id != permit.attempt_id or \
            event.permit_hash != permit.permit_hash or \
            event.instrument_version_id != permit.instrument_version_id or \
            event.instrument_version_id != state.instrument_version_id or \
            instrument.instrument_version_id != state.instrument_version_id or \
            instrument.registry_hash != state.instrument_registry_hash or \
            event.quantity_kind != permit.quantity_kind or \
            event.quantity_kind != state.quantity_kind or \
            type(margin_bps) is not int or not 0 <= margin_bps <= 10_000:
        raise FinanceError("simulated economic event differs from permit or position")
    if event.kind == "fill":
        effect = calculate_fill_effect(state, permit, event, instrument,
                                       margin_bps=margin_bps)
    else:
        effect = calculate_funding_effect(state, event, instrument)
    postings = _postings(effect, event, state)
    body = dict(scope=event.scope, expected_revision=expected_revision,
                writer_epoch=writer_epoch,
                idempotency_key=f"simulation-event:{event.event_hash}",
                request_hash="0" * 64,
                source_owner=f"simulation:{event.run_id}",
                source_stream=event.source_stream,
                source_event_id=event.source_event_id,
                source_revision=event.source_revision,
                source_event_hash="0" * 64,
                source_payload_hash=event.source_payload_hash,
                kind=event.kind, observed_at=event.event_at,
                postings=postings, reverses_transaction_id=None)
    body["source_event_hash"] = source_event_digest(JournalCommand.model_construct(**body))
    body["request_hash"] = semantic_request_hash(
        "journal", JournalCommand.model_construct(**body))
    return effect, JournalCommand.model_validate(body)
