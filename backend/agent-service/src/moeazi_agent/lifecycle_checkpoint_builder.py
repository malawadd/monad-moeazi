"""Canonical simulation-only observation from independently replayed economics."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest, _utc, native_int
from .finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance, ObservedPosition,
)
from .lifecycle_checkpoint_oracle import ReplayAccountOracle
from .lifecycle_contracts import ExecutionEvent


def build_derived_account_snapshot(
    baseline: AccountObservationSnapshotRef,
    oracle: ReplayAccountOracle,
    events: tuple[ExecutionEvent, ...],
    *, scope: FinanceScope, run_id: str, manifest_hash: str,
    policy_version: str, replay_cursor_at: datetime,
) -> AccountObservationSnapshotRef:
    if scope.environment != "experiment" or baseline.scope != scope or \
            not run_id or not policy_version or oracle.source_count != len(events):
        raise FinanceError("derived account snapshot lacks exact replay provenance")
    cursor = _utc(replay_cursor_at)
    if any(event.scope != scope or event.run_id != run_id or
           event.simulation_cursor_at > cursor for event in events):
        raise FinanceError("derived account snapshot includes a future or foreign source")
    balances = tuple(ObservedBalance(asset_unit_id=asset, registry_hash=registry,
        location_id=location, book=book, units=str(units))
        for (asset, registry, location, book), units in sorted(oracle.balances.items())
        if book in {"wallet", "collateral"})
    fee_ids: dict[str, set[str]] = defaultdict(set)
    funding_ids: dict[str, set[str]] = defaultdict(set)
    for event in events:
        if event.kind == "fill" and native_int(event.fee_units or "0"):
            fee_ids[event.instrument_version_id].add(event.source_event_id)
        if event.kind == "funding":
            funding_ids[event.instrument_version_id].add(event.source_event_id)
    positions = []
    for key in sorted(oracle.positions):
        state = oracle.positions[key]
        if state.quantity_kind != "contracts":
            continue
        if state.contract_size_unit_id is None:
            raise FinanceError("derived perpetual position has no multiplier unit")
        positions.append(ObservedPosition(
            instrument_version_id=state.instrument_version_id,
            location_id=state.location_id,
            instrument_registry_hash=state.instrument_registry_hash,
            contract_size_unit_id=state.contract_size_unit_id,
            signed_contracts=state.signed_quantity_units,
            collateral_asset_unit_id=state.settlement_asset_unit_id,
            margin_units=state.margin_reserved_units,
            funding_event_ids=tuple(sorted(funding_ids[state.instrument_version_id])),
            fee_event_ids=tuple(sorted(fee_ids[state.instrument_version_id]))))
    bodies = {"balances": [row.model_dump(mode="json") for row in balances],
              "positions": [row.model_dump(mode="json") for row in positions]}
    source_hash = _digest("moeazi-simulation-account-source-v1", {
        "runId": run_id, "manifestHash": manifest_hash,
        "cursorAt": cursor.isoformat(), "sourceRoot": oracle.source_root})
    payload_hash = _digest("moeazi-simulation-account-payload-v1", bodies)
    body = dict(scope=scope, snapshot_hash="0" * 64,
        source_account_id=baseline.source_account_id,
        origin="simulation_derived", status="accepted",
        event_at=cursor, available_at=cursor, received_at=cursor,
        cutoff_at=cursor, finality_at=cursor, finality="admitted_final",
        has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="local_simulation_fixture_only",
        source_event_hash=source_hash, source_payload_hash=payload_hash,
        registry_hash=baseline.registry_hash, policy_version=policy_version,
        observed_balances=balances, observed_positions=tuple(positions))
    provisional = AccountObservationSnapshotRef.model_validate(body)
    body["snapshot_hash"] = account_snapshot_hash(provisional)
    return AccountObservationSnapshotRef.model_validate(body)
