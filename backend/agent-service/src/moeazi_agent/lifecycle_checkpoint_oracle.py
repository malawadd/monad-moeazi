"""Reconstruct simulated account economics independently of persisted balances."""
from __future__ import annotations

from dataclasses import dataclass

from .finance_contracts import FinanceError, _digest, native_int
from .finance_observation_contracts import AccountObservationSnapshotRef
from .finance_oracle import journal_root
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_event_economics import build_event_economics
from .lifecycle_position_math import empty_position_state
from .lifecycle_position_math_contracts import PositionArithmeticState
from .observation_contracts import InstrumentVersion

BalanceKey = tuple[str, str, str, str]
PositionKey = tuple[str, str]


@dataclass(frozen=True)
class ReplayAccountOracle:
    balances: dict[BalanceKey, int]
    positions: dict[PositionKey, PositionArithmeticState]
    source_root: str
    journal_root: str
    position_root: str
    source_count: int
    economic_count: int
    economic_source_hashes: tuple[str, ...]


def reconstruct_replay_account(
    baseline: AccountObservationSnapshotRef,
    events: tuple[ExecutionEvent, ...],
    permits: tuple[ExecutionPermit, ...],
    instruments: tuple[InstrumentVersion, ...],
    margin_bps_by_instrument: dict[str, int],
) -> ReplayAccountOracle:
    """Use only baseline + immutable events, never finance_balances as expected state."""
    if baseline.scope.environment != "experiment" or baseline.status != "accepted" or \
            baseline.finality != "admitted_final" or baseline.has_gap or \
            baseline.has_reorg or not baseline.balances_complete or \
            not baseline.positions_complete or baseline.observed_positions:
        raise FinanceError("replay oracle requires a complete flat experiment baseline")
    if (baseline.origin, baseline.rights_ref) not in {
            ("recorded_fixture", "internal_qualification_only"),
            ("native_verified", "internal_qualification_only")}:
        raise FinanceError("replay baseline cannot be a derived financial checkpoint")
    orders = {item.order_id: item for item in permits}
    registry = {item.instrument_version_id: item for item in instruments}
    if len(orders) != len(permits) or len(registry) != len(instruments) or \
            any(item.scope != baseline.scope for item in permits):
        raise FinanceError("replay oracle has duplicate or cross-account identities")
    ledger: dict[BalanceKey, int] = {}
    identities: dict[tuple[str, str, str], str] = {}

    def change(key: BalanceKey, amount: int) -> None:
        identity = (key[0], key[2], key[3])
        old_registry = identities.setdefault(identity, key[1])
        if old_registry != key[1]:
            raise FinanceError("replay changed an asset registry inside one balance")
        ledger[key] = ledger.get(key, 0) + amount
        if key[3] in {"wallet", "collateral", "transit", "liability"} and ledger[key] < 0:
            raise FinanceError("replayed account balance became negative")

    for row in baseline.observed_balances:
        amount = native_int(row.units, nonnegative=True)
        if row.book not in {"wallet", "collateral"} and amount:
            raise FinanceError("baseline encumbrance has no declared replay model")
        change((row.asset_unit_id, row.registry_hash,
                row.location_id, row.book), amount)
        if amount:
            change((row.asset_unit_id, row.registry_hash,
                    "external:opening", "external"), -amount)
    positions: dict[PositionKey, PositionArithmeticState] = {}
    cumulatives = {item.order_id: 0 for item in permits}
    seen: set[str] = set()
    previous_order: tuple | None = None
    economic_count = 0
    economic_hashes: list[str] = []
    for event in events:
        if event.simulation_cursor_at < baseline.cutoff_at or \
                (event.kind in {"fill", "funding"} and
                 event.simulation_cursor_at <= baseline.cutoff_at):
            raise FinanceError("replay source fact precedes opening account cutoff")
        sequence_key = (event.simulation_cursor_at, event.order_ordinal,
                        event.sequence, event.source_event_id)
        if previous_order is not None and sequence_key < previous_order:
            raise FinanceError("replay source facts are out of global chronology")
        previous_order = sequence_key
        if event.event_hash in seen or event.scope != baseline.scope:
            raise FinanceError("replay source event is duplicate or cross-account")
        seen.add(event.event_hash)
        permit = orders.get(event.order_id)
        if permit is None or permit.permit_hash != event.permit_hash or \
                permit.order_ordinal != event.order_ordinal or \
                permit.instrument_version_id != event.instrument_version_id:
            raise FinanceError("replay source event lacks a matched submitted permit")
        if event.kind not in {"fill", "funding"}:
            continue
        instrument = registry.get(event.instrument_version_id)
        if instrument is None or instrument.registry_hash != permit.instrument_registry_hash:
            raise FinanceError("replay source instrument is unavailable")
        key = (instrument.instrument_version_id, permit.location_id)
        state = positions.get(key) or empty_position_state(permit, instrument)
        if event.kind == "fill":
            quantity = native_int(event.fill_quantity_units or "0", positive=True)
            cumulative = cumulatives[event.order_id] + quantity
            if cumulative != native_int(event.cumulative_filled_units) or \
                    cumulative > native_int(permit.quantity_units):
                raise FinanceError("replay fill cumulative amount differs")
            cumulatives[event.order_id] = cumulative
        elif native_int(event.cumulative_filled_units) != cumulatives[event.order_id]:
            raise FinanceError("replay funding changed fill quantity")
        margin_bps = margin_bps_by_instrument.get(instrument.instrument_version_id)
        if margin_bps is None:
            raise FinanceError("replay instrument lacks declared margin policy")
        effect, command = build_event_economics(event, permit, instrument,
            state, margin_bps=margin_bps, expected_revision=0, writer_epoch=1)
        for posting in command.postings:
            change((posting.asset_unit_id, posting.registry_hash,
                    posting.location_id, posting.book), native_int(posting.units))
        positions[key] = effect.new_state
        economic_count += 1
        economic_hashes.append(command.source_event_hash)
    source_root = _digest("moeazi-simulation-source-root-v1",
                          {"eventHashes": [item.event_hash for item in events]})
    position_bodies = [positions[key].model_dump(mode="json")
                       for key in sorted(positions)]
    position_root = _digest("moeazi-simulation-position-root-v1",
                            {"positions": position_bodies})
    actual_journal_root = journal_root((asset, location, book, units)
        for (asset, _registry, location, book), units in ledger.items())
    return ReplayAccountOracle(balances=ledger, positions=positions,
        source_root=source_root, journal_root=actual_journal_root,
        position_root=position_root, source_count=len(events),
        economic_count=economic_count,
        economic_source_hashes=tuple(economic_hashes))
