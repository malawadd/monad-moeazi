"""Independently verify a simulated checkpoint against committed financial state."""
from __future__ import annotations

import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, db_native_int
from .finance_observation_contracts import account_snapshot_from_row
from .finance_oracle import journal_root
from .finance_policy import SizingPolicy
from .lifecycle_checkpoint_oracle import ReplayAccountOracle, reconstruct_replay_account
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_source_replay import materialize_run_events
from .observation_contracts import InstrumentVersion


async def verify_replay_checkpoint(conn, scope: FinanceScope,
                                   manifest: SimulationRunManifest, run: dict,
                                   account: dict, *, read_only: bool = False
                                   ) -> tuple[ReplayAccountOracle, tuple[ExecutionEvent, ...]]:
    """All due facts must be folded; unrelated account economics fail closed."""
    if scope.environment != "experiment" or manifest.scope != scope or \
            manifest.run_id != run["run_id"] or \
            manifest.manifest_hash != run["manifest_hash"] or \
            account["source_account_id"] is None:
        raise FinanceError("replay checkpoint lacks registered account identity")
    params = _run_params(scope, manifest.run_id)
    model_facts = await materialize_run_events(conn, manifest, read_only=read_only)
    baseline_row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
    """), {"hash": manifest.account_snapshot_hash})).mappings().first()
    if baseline_row is None:
        raise FinanceError("replay baseline account observation is missing")
    baseline = account_snapshot_from_row(baseline_row)
    if account_snapshot_hash(baseline) != baseline.snapshot_hash or \
            baseline.scope != scope or \
            baseline.source_account_id != account["source_account_id"] or \
            baseline.cutoff_at > manifest.scenario.simulation_cursor_at or \
            (baseline.origin, baseline.rights_ref) not in {
                ("recorded_fixture", "internal_qualification_only"),
                ("native_verified", "internal_qualification_only")}:
        raise FinanceError("replay baseline account observation differs")
    current_hash = account["observation_snapshot_hash"]
    if current_hash != baseline.snapshot_hash:
        prior = (await conn.execute(text("""
            SELECT 1 FROM simulation_derived_snapshots
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND manifest_hash=:manifest AND baseline_snapshot_hash=:baseline
              AND snapshot_hash=:current
        """), {**params, "manifest": manifest.manifest_hash,
               "baseline": baseline.snapshot_hash, "current": current_hash})).first()
        if prior is None:
            raise FinanceError("current financial checkpoint belongs to another source")
    event_rows = (await conn.execute(text("""
        SELECT event_hash,event_json FROM simulation_order_events
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND simulation_cursor_at<=:cursor
        ORDER BY simulation_cursor_at,
          (event_json->>'order_ordinal')::bigint,sequence,source_event_id
    """), {**params, "cursor": run["replay_cursor_at"]})).mappings().all()
    events = tuple(ExecutionEvent.model_validate_json(json.dumps(row["event_json"]))
                   for row in event_rows)
    if any(event.event_hash != row["event_hash"] for event, row in zip(events, event_rows)):
        raise FinanceError("persisted replay source fact hash differs")
    if tuple(event.event_hash for event in events) != \
            tuple(event.event_hash for event in model_facts):
        raise FinanceError("persisted replay source is not the frozen model prefix")
    fold_rows = (await conn.execute(text("""
        SELECT event_hash,event_kind,transaction_id FROM simulation_event_folds
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().all()
    folds = {row["event_hash"]: row for row in fold_rows}
    if len(folds) != len(events) or set(folds) != {e.event_hash for e in events} or \
            any(folds[e.event_hash]["event_kind"] != e.kind for e in events):
        raise FinanceError("replay source facts are not completely folded")
    order_rows = (await conn.execute(text("""
        SELECT permit_json,permit_hash FROM simulation_orders
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        ORDER BY order_ordinal
    """), params)).mappings().all()
    permits = tuple(ExecutionPermit.model_validate_json(json.dumps(row["permit_json"]))
                    for row in order_rows)
    if any(permit.permit_hash != row["permit_hash"] for permit, row in zip(permits, order_rows)):
        raise FinanceError("replay permit hash differs")
    instrument_rows = (await conn.execute(text("""
        SELECT instrument_version_id,manifest,registry_hash
        FROM observation_instrument_versions
        WHERE instrument_version_id=ANY(:ids)
    """), {"ids": list(manifest.instrument_version_ids)})).mappings().all()
    instruments = tuple(InstrumentVersion.model_validate(row["manifest"])
                        for row in instrument_rows)
    if len(instruments) != len(manifest.instrument_version_ids) or \
            {i.instrument_version_id for i in instruments} != set(manifest.instrument_version_ids) or \
            any(item.instrument_version_id != row["instrument_version_id"] or
                item.registry_hash != row["registry_hash"]
                for item, row in zip(instruments, instrument_rows)):
        raise FinanceError("replay instrument registry differs")
    policy_row = (await conn.execute(text("""
        SELECT policy_json,policy_hash FROM finance_policy_versions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND policy_version=:version
    """), {**params, "version": manifest.policy_version})).mappings().first()
    if not policy_row or policy_row["policy_hash"] != manifest.policy_hash:
        raise FinanceError("replay financial policy is missing")
    policy = SizingPolicy.model_validate_json(json.dumps(policy_row["policy_json"]))
    if policy.policy_hash != manifest.policy_hash or \
            any(p.instrument_version_id != policy.instrument_version_id for p in permits):
        raise FinanceError("replay uses an unqualified multi-instrument policy")
    oracle = reconstruct_replay_account(baseline, events, permits, instruments,
        {policy.instrument_version_id: policy.initial_margin_bps})
    balance_rows = (await conn.execute(text("""
        SELECT asset_unit_id,registry_hash,location_id,book,units
        FROM finance_balances WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), params)).mappings().all()
    actual = {(r["asset_unit_id"],r["registry_hash"],r["location_id"],r["book"]):
              db_native_int(r["units"]) for r in balance_rows}
    if len(actual) != len(balance_rows) or \
            {k: v for k, v in actual.items() if v} != \
            {k: v for k, v in oracle.balances.items() if v}:
        raise FinanceError("financial ledger differs from independent replay")
    actual_root = journal_root((asset, location, book, units)
        for (asset, _registry, location, book), units in actual.items())
    if actual_root != oracle.journal_root:
        raise FinanceError("replay journal root differs")
    journal_rows = (await conn.execute(text("""
        SELECT source_event_hash,transaction_id FROM finance_journal_transactions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), params)).mappings().all()
    journals = {row["source_event_hash"]: row["transaction_id"] for row in journal_rows}
    expected_sources = {baseline.source_event_hash, *oracle.economic_source_hashes}
    if len(journals) != len(journal_rows) or set(journals) != expected_sources:
        raise FinanceError("account has unmodeled or missing journal economics")
    link_rows = (await conn.execute(text("""
        SELECT event_hash,transaction_id FROM simulation_event_journal_links
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().all()
    links = {row["event_hash"]: row["transaction_id"] for row in link_rows}
    economic_events = [event for event in events if event.kind in {"fill", "funding"}]
    if len(links) != len(link_rows) or set(links) != {e.event_hash for e in economic_events} or \
            any(links[e.event_hash] != folds[e.event_hash]["transaction_id"] or
                links[e.event_hash] != journals[source]
                for e, source in zip(economic_events, oracle.economic_source_hashes)):
        raise FinanceError("economic source, journal, and fold links differ")
    position_rows = (await conn.execute(text("""
        SELECT instrument_version_id,location_id,arithmetic_state_json,
          arithmetic_state_hash,signed_exposure_units,collateral_units
        FROM simulation_positions WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().all()
    positions = {(row["instrument_version_id"], row["location_id"]): row
                 for row in position_rows}
    if len(positions) != len(position_rows) or set(positions) != set(oracle.positions):
        raise FinanceError("replay position set differs from source economics")
    from .finance_contracts import _digest
    for key, expected in oracle.positions.items():
        row = positions[key]
        actual_state = PositionArithmeticState.model_validate_json(
            json.dumps(row["arithmetic_state_json"]))
        if actual_state != expected or \
                _digest("moeazi-position-arithmetic-v1", actual_state.model_dump(mode="json")) != \
                row["arithmetic_state_hash"] or \
                db_native_int(row["signed_exposure_units"]) != int(expected.signed_quantity_units) or \
                db_native_int(row["collateral_units"]) != int(expected.collateral_units):
            raise FinanceError("persisted position differs from independent replay")
    return oracle, events
