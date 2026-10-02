"""Deterministic experiment-only CLOB source events; never a financial ledger."""
from __future__ import annotations

from datetime import datetime, timedelta
from fractions import Fraction

from .finance_contracts import FinanceError, _digest, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_simulator_models import (
    MODEL_VERSION, MODEL_ASSUMPTIONS, MODEL_HASH,
    CAUSAL_MODEL_ASSUMPTIONS, CAUSAL_MODEL_HASH,
)
from .lifecycle_run_contracts import SimulationScenario, simulation_dataset_hash
from .observation_contracts import InstrumentVersion, MarketObservation, canonical_hash

def _ceil(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def _floor(value: Fraction) -> int:
    return value.numerator // value.denominator


def _ratio(price: str, instrument: InstrumentVersion) -> Fraction:
    return Fraction(price) * 10 ** instrument.quote_decimals / 10 ** instrument.base_decimals


def _source_event(permit: ExecutionPermit, scenario: SimulationScenario,
                  sequence: int, kind: str, when: datetime, cumulative: int,
                  *, source_stream: str,
                  observation: MarketObservation | None = None,
                  fill: int | None = None, price: Fraction | None = None,
                  fee: tuple[str, str, str] | None = None,
                  funding: tuple[str, str, str] | None = None,
                  protection_order_id: str | None = None,
                  terminal_reason: str | None = None,
                  source_event_id: str | None = None) -> ExecutionEvent:
    observation_hash = (canonical_hash(observation.model_dump(mode="json"))
                        if observation is not None else None)
    event_id = source_event_id or _digest("moeazi-sim-source-id-v1", {
        "permitHash": permit.permit_hash, "scenarioHash": scenario.scenario_hash,
        "sequence": sequence, "kind": kind,
    })
    body = {
        "schema_version": 1, "scope": permit.scope,
        "run_id": permit.run_id, "run_manifest_hash": permit.run_manifest_hash,
        "scenario_hash": scenario.scenario_hash,
        "simulation_model_version": scenario.model_version,
        "dataset_hash": scenario.dataset_hash,
        "instrument_version_id": permit.instrument_version_id,
        "order_id": permit.order_id, "order_ordinal": permit.order_ordinal,
        "client_id": permit.client_id, "attempt_id": permit.attempt_id,
        "permit_hash": permit.permit_hash, "source_stream": source_stream,
        "source_event_id": event_id, "source_revision": "1", "sequence": sequence,
        "kind": kind, "quantity_kind": permit.quantity_kind,
        "contract_size_unit_id": permit.contract_size_unit_id,
        "contract_size_units": permit.contract_size_units,
        "event_at": when, "available_at": when, "simulation_cursor_at": when,
        "fill_quantity_units": str(fill) if fill is not None else None,
        "cumulative_filled_units": str(cumulative),
        "price_numerator": str(price.numerator) if price is not None else None,
        "price_denominator": str(price.denominator) if price is not None else None,
        "fee_asset_unit_id": fee[0] if fee else None,
        "fee_registry_hash": fee[1] if fee else None,
        "fee_units": fee[2] if fee else None,
        "funding_asset_unit_id": funding[0] if funding else None,
        "funding_registry_hash": funding[1] if funding else None,
        "funding_units": funding[2] if funding else None,
        "protection_order_id": protection_order_id,
        "terminal_reason": terminal_reason,
        "observation_hash": observation_hash,
        "observation_source_kind": observation.source_kind if observation else None,
    }
    wire = ExecutionEvent.model_construct(**body).model_dump(
        mode="json", exclude={"source_payload_hash", "event_hash"})
    source_payload_hash = _digest("moeazi-sim-source-payload-v1", wire)
    body["source_payload_hash"] = source_payload_hash
    body["event_hash"] = _digest("moeazi-execution-event-v1",
        ExecutionEvent.model_construct(**body).model_dump(mode="json", exclude={"event_hash"}))
    return ExecutionEvent.model_validate(body)


def _validate(permit: ExecutionPermit, instrument: InstrumentVersion,
              observations: tuple[MarketObservation, ...], scenario: SimulationScenario) -> None:
    if scenario.model_version != MODEL_VERSION or scenario.model_hash != MODEL_HASH:
        raise FinanceError("unsupported simulation model identity")
    if scenario.dataset_hash != simulation_dataset_hash(observations):
        raise FinanceError("simulation dataset differs from frozen input tuple")
    if instrument.instrument_version_id != permit.instrument_version_id or \
            instrument.registry_hash != permit.instrument_registry_hash or \
            instrument.base_asset_unit_id != permit.quantity_asset_unit_id or \
            instrument.quote_asset_unit_id != permit.quote_asset_unit_id or \
            instrument.settlement_asset_unit_id != permit.settlement_asset_unit_id:
        raise FinanceError("permit and instrument registry differ")
    if permit.quantity_kind == "contracts":
        size = Fraction(instrument.contract_multiplier) * 10 ** instrument.base_decimals
        if instrument.product_kind != "perpetual" or size.denominator != 1 or \
                permit.contract_size_unit_id != instrument.base_asset_unit_id or \
                native_int(permit.contract_size_units or "0") != size.numerator or \
                instrument.quote_asset_unit_id != instrument.settlement_asset_unit_id or \
                instrument.quote_decimals != instrument.settlement_decimals or \
                instrument.margin_model != "linear_v1":
            raise FinanceError("unsupported or mismatched linear perpetual definition")
    elif instrument.product_kind != "spot":
        raise FinanceError("spot permit requires spot instrument")
    if scenario.queue_model != "no_queue_estimate":
        raise FinanceError("recorded queue priority is not supported")
    for row in observations:
        if row.instrument_version_id != instrument.instrument_version_id:
            continue
        if row.source_id != instrument.venue_id or \
                row.source_kind not in {"recorded_native", "documented_example",
                                        "synthetic_fault"} or \
                row.finality not in {"not_applicable", "confirmed"} or \
                row.event_at > row.available_at or row.available_at > row.received_at or \
                (row.source_kind == "recorded_native" and
                 row.source_rights_ref != "internal_qualification_only") or \
                (row.source_kind == "documented_example" and
                 row.source_rights_ref != "documentation_example_only") or \
                (row.source_kind == "synthetic_fault" and
                 row.source_rights_ref != "local_simulation_fixture_only"):
            raise FinanceError("simulation corpus contains inadmissible market observation")
        bids = tuple(Fraction(level.price_quote_per_base) for level in row.bids)
        asks = tuple(Fraction(level.price_quote_per_base) for level in row.asks)
        if instrument.effective_at > row.event_at or bids[0] >= asks[0] or \
                any(left <= right for left, right in zip(bids, bids[1:])) or \
                any(left >= right for left, right in zip(asks, asks[1:])) or \
                any(Fraction(level.size_base) % Fraction(instrument.lot_step)
                    for level in (*row.bids, *row.asks)):
            raise FinanceError("simulation corpus contains invalid native book or version")


def simulate_order(permit: ExecutionPermit, instrument: InstrumentVersion,
                   observations: tuple[MarketObservation, ...],
                   scenario: SimulationScenario,
                   decision_context: ReplayDecisionContext | None = None
                   ) -> tuple[ExecutionEvent, ...]:
    """Emit source facts for one order; storage must bind accepted evidence separately."""
    _validate(permit, instrument, observations, scenario)
    if decision_context is None:
        if permit.issued_at_cursor != scenario.simulation_cursor_at or \
                getattr(permit, "decision_context_hash", None) is not None:
            raise FinanceError("later order requires a persisted replay decision")
        decision_cutoff = scenario.evidence_cutoff_at
    else:
        if decision_context.scope != permit.scope or \
                decision_context.run_id != permit.run_id or \
                decision_context.run_manifest_hash != permit.run_manifest_hash or \
                decision_context.controller_ref != permit.controller_ref or \
                decision_context.instrument_version_id != permit.instrument_version_id or \
                decision_context.evidence_snapshot_hash != permit.evidence_snapshot_hash or \
                getattr(permit, "decision_context_hash", None) != decision_context.decision_hash or \
                decision_context.cursor_at != permit.issued_at_cursor or \
                not scenario.simulation_cursor_at <= decision_context.cursor_at <= \
                scenario.simulation_end_at:
            raise FinanceError("permit differs from persisted replay decision")
        decision_cutoff = decision_context.evidence_cutoff_at
    dispatch_at = max(permit.issued_at_cursor, scenario.simulation_cursor_at)
    if dispatch_at > permit.valid_until_cursor:
        raise FinanceError("permit expired before simulated dispatch")
    known = [row for row in observations
             if row.instrument_version_id == instrument.instrument_version_id and
             row.available_at <= decision_cutoff]
    latest = max(known, key=lambda row: (row.available_at, row.event_at,
                 row.source_id, row.source_event_id), default=None)
    if latest is None or (dispatch_at - latest.event_at).total_seconds() * 1000 > \
            scenario.max_book_age_ms:
        raise FinanceError("stale or missing book blocks simulated dispatch")
    accepted_at = dispatch_at + timedelta(milliseconds=scenario.latency_ms)
    if accepted_at > scenario.simulation_end_at:
        raise FinanceError("simulated acceptance is outside replay window")
    if (accepted_at - latest.event_at).total_seconds() * 1000 > scenario.max_book_age_ms:
        raise FinanceError("book became stale before simulated acceptance")
    schedule = tuple(rule for rule in scenario.outcome_rules
                     if rule.order_ordinal == permit.order_ordinal)
    protective = permit.protection_order_id is not None
    protected_outcomes = tuple(rule for rule in schedule
                               if rule.kind.startswith("protection_"))
    if not protective and protected_outcomes or protective and \
            scenario.protection_outcome_model == "scenario_events" and \
            len(protected_outcomes) != 1 or protective and \
            scenario.protection_outcome_model != "scenario_events" and protected_outcomes:
        raise FinanceError("protection outcome lacks an exact protective order rule")
    terminal = min((rule for rule in schedule if rule.kind in {"cancelled", "rejected"}),
                   key=lambda rule: rule.at_cursor, default=None)
    if terminal is not None and terminal.at_cursor < accepted_at:
        raise FinanceError("terminal source outcome precedes simulated acceptance")
    entries: list[tuple[datetime, int, str, dict]] = [(accepted_at, 0, "accepted", {})]
    protection_at = accepted_at
    protection_confirmed = True
    if protective:
        if scenario.protection_outcome_model == "scenario_events":
            outcome = protected_outcomes[0]
            protection_at = outcome.at_cursor
            kind = outcome.kind
            source_id = outcome.source_event_id
        else:
            kind = ("protection_accepted" if scenario.protection_outcome_model == "confirm"
                    else "protection_rejected")
            source_id = None
        if protection_at < accepted_at:
            raise FinanceError("protective source outcome precedes submission")
        protection_confirmed = kind == "protection_accepted"
        entries.append((protection_at, 1, kind, {
            "source_event_id": source_id,
            "protection_order_id": permit.protection_order_id,
        }))
    if terminal and terminal.kind == "cancelled":
        requested_at = terminal.at_cursor - timedelta(milliseconds=scenario.cancel_latency_ms)
        if requested_at < accepted_at:
            raise FinanceError("cancel request precedes simulated acceptance")
        entries.append((requested_at, 3, "cancel_requested", {}))
    for rule in schedule:
        if rule.kind.startswith("protection_"):
            continue
        entries.append((rule.at_cursor, 4, rule.kind, {
            "source_event_id": rule.source_event_id,
        }))
    for rule in scenario.funding_rules:
        if rule.order_ordinal == permit.order_ordinal and \
                rule.instrument_version_id == instrument.instrument_version_id:
            entries.append((rule.at_cursor, 5, "funding", {
                "source_event_id": rule.source_event_id,
                "funding": (rule.asset_unit_id, rule.registry_hash, rule.signed_units),
            }))
    # Each book level is a visible, bounded opportunity. No synthetic refill or queue claim.
    remaining = native_int(permit.quantity_units, positive=True)
    fill_ordinal = 0
    ordered = sorted((row for row in observations if row.instrument_version_id ==
                      instrument.instrument_version_id),
                     key=lambda item: (item.available_at, item.source_id,
                     item.source_event_id, item.raw_payload_hash))
    prior = [row for row in ordered if row.available_at <= accepted_at]
    usable = ([prior[-1]] if prior else []) + [row for row in ordered
                                                if row.available_at > accepted_at]
    for row in usable if protection_confirmed and \
            (terminal is None or terminal.kind != "rejected") else ():
        when = max(accepted_at, protection_at, row.available_at)
        if when > scenario.simulation_end_at or (terminal and when >= terminal.at_cursor):
            continue
        if (when - row.event_at).total_seconds() * 1000 > scenario.max_book_age_ms:
            continue
        levels = row.asks if permit.side == "buy" else row.bids
        for level in levels:
            unit_size = Fraction(level.size_base) * 10 ** instrument.base_decimals
            if unit_size.denominator != 1:
                raise FinanceError("book size cannot be expressed in base native units")
            depth = _floor(unit_size * scenario.depth_participation_bps / 10_000)
            if permit.quantity_kind == "contracts":
                depth //= native_int(permit.contract_size_units or "0", positive=True)
            amount = min(remaining, depth)
            if amount <= 0:
                continue
            fill_ordinal += 1
            price = _ratio(level.price_quote_per_base, instrument)
            base_units = amount * (native_int(permit.contract_size_units or "0", positive=True)
                                   if permit.quantity_kind == "contracts" else 1)
            notional = Fraction(base_units) * price
            fee_rule = next((rule for rule in scenario.fee_rules
                             if (rule.order_ordinal, rule.fill_ordinal) ==
                             (permit.order_ordinal, fill_ordinal)), None)
            fee = ((fee_rule.asset_unit_id, fee_rule.registry_hash, fee_rule.units)
                   if fee_rule else (permit.quote_asset_unit_id, permit.quote_registry_hash,
                                     str(_ceil(notional * scenario.fee_bps / 10_000))))
            entries.append((when, 2, "fill", {"observation": row, "fill": amount,
                    "price": price, "fee": fee}))
            remaining -= amount
            if not remaining:
                break
        if not remaining:
            break
    result: list[ExecutionEvent] = []
    cumulative = 0
    source_stream = ("moeazi_simulation_synthetic_v1"
                     if any(row.source_kind == "synthetic_fault" for row in observations)
                     else "moeazi_simulation_v1")
    for when, _, kind, extra in sorted(entries, key=lambda item: (item[0], item[1],
                                      item[3].get("source_event_id") or "")):
        if kind == "fill":
            cumulative += extra["fill"]
        result.append(_source_event(permit, scenario, len(result), kind, when,
                                   cumulative, source_stream=source_stream, **extra))
    return tuple(result)
