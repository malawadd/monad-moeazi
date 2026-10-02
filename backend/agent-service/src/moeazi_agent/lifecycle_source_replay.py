"""Materialize cursor-due simulator facts; never fold financial effects here."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

from sqlalchemy import text

from .finance_contracts import FinanceError, _utc
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_cancel_receipts import load_cancel_dispatches
from .lifecycle_dataset import load_dataset
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_replay import simulate_run
from .lifecycle_source_economics import load_source_economics
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import InstrumentVersion


async def _permits(conn, manifest: SimulationRunManifest,
                   params: dict) -> tuple[ExecutionPermit, ...]:
    rows = (await conn.execute(text("""
        SELECT order_id,order_ordinal,permit_hash,permit_json
        FROM simulation_orders WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        ORDER BY order_ordinal
    """), params)).mappings().all()
    permits = tuple(ExecutionPermit.model_validate_json(json.dumps(row["permit_json"]))
                    for row in rows)
    if any(permit.order_id != row["order_id"] or
           permit.order_ordinal != row["order_ordinal"] or
           permit.permit_hash != row["permit_hash"] or
           permit.run_manifest_hash != manifest.manifest_hash
           for permit, row in zip(permits, rows)):
        raise FinanceError("persisted replay permit differs from order identity")
    return permits


async def _contexts(conn, permits: tuple[ExecutionPermit, ...],
                    params: dict) -> dict[str, ReplayDecisionContext]:
    hashes = [item.decision_context_hash for item in permits
              if item.decision_context_hash is not None]
    if not hashes:
        return {}
    rows = (await conn.execute(text("""
        SELECT decision_hash,decision_json FROM simulation_decision_contexts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND decision_hash = ANY(CAST(:hashes AS text[]))
    """), {**params, "hashes": hashes})).mappings().all()
    by_hash = {row["decision_hash"]: row for row in rows}
    result: dict[str, ReplayDecisionContext] = {}
    for permit in permits:
        digest = permit.decision_context_hash
        if digest is None:
            continue
        row = by_hash.get(digest)
        if row is None:
            raise FinanceError("submitted order has no frozen decision context")
        context = ReplayDecisionContext.model_validate_json(json.dumps(row["decision_json"]))
        if context.decision_hash != digest or context.run_id != permit.run_id or \
                context.run_manifest_hash != permit.run_manifest_hash or \
                context.scope != permit.scope or \
                context.instrument_version_id != permit.instrument_version_id or \
                context.evidence_snapshot_hash != permit.evidence_snapshot_hash or \
                context.cursor_at != permit.issued_at_cursor:
            raise FinanceError("stored replay decision differs from permit")
        result[permit.order_id] = context
    return result


async def _instruments(conn, manifest: SimulationRunManifest
                       ) -> tuple[InstrumentVersion, ...]:
    rows = (await conn.execute(text("""
        SELECT instrument_version_id,registry_hash,manifest
        FROM observation_instrument_versions
        WHERE instrument_version_id = ANY(CAST(:ids AS text[]))
    """), {"ids": list(manifest.instrument_version_ids)})).mappings().all()
    by_id = {row["instrument_version_id"]: row for row in rows}
    if set(by_id) != set(manifest.instrument_version_ids):
        raise FinanceError("replay instrument registry is incomplete")
    result = tuple(InstrumentVersion.model_validate(by_id[key]["manifest"])
                   for key in manifest.instrument_version_ids)
    if any(item.instrument_version_id != key or
           item.registry_hash != by_id[key]["registry_hash"]
           for key, item in zip(manifest.instrument_version_ids, result)):
        raise FinanceError("replay instrument registry body differs")
    return result


async def _simulated(conn, manifest: SimulationRunManifest, params: dict, *,
                     read_only: bool = False
                     ) -> tuple[ExecutionEvent, ...]:
    permits = await _permits(conn, manifest, params)
    if not permits:
        return ()
    contexts = await _contexts(conn, permits, params)
    cancel_receipts = await load_cancel_dispatches(conn, manifest)
    dataset = await load_dataset(conn, manifest, read_only=read_only)
    instruments = await _instruments(conn, manifest)
    anchors, margin_bps = await load_source_economics(conn, manifest, permits)
    return simulate_run(manifest, permits, instruments, dataset, contexts,
                        cancel_receipts, position_anchors=anchors,
                        margin_bps=margin_bps)


async def preflight_simulation(conn, manifest: SimulationRunManifest,
                               candidate: ExecutionPermit) -> tuple[ExecutionEvent, ...]:
    """Reject an unsupported candidate before any possible submission is stored."""
    params = _run_params(manifest.scope, manifest.run_id)
    earlier = await _permits(conn, manifest, params)
    if candidate.scope != manifest.scope or candidate.run_id != manifest.run_id or \
            candidate.run_manifest_hash != manifest.manifest_hash or \
            candidate.order_id in {item.order_id for item in earlier}:
        raise FinanceError("candidate preflight differs from the frozen run")
    permits = (*earlier, candidate)
    contexts = await _contexts(conn, permits, params)
    cancel_receipts = await load_cancel_dispatches(conn, manifest)
    dataset = await load_dataset(conn, manifest)
    instruments = await _instruments(conn, manifest)
    events = simulate_run(manifest, permits, instruments, dataset, contexts,
                          cancel_receipts)
    return tuple(event for event in events if event.order_id == candidate.order_id)


async def next_due_event_cursor(conn, manifest: SimulationRunManifest,
                                current_cursor: datetime) -> datetime | None:
    """Return the next frozen source fact time without moving the durable cursor."""
    current = _utc(current_cursor)
    params = _run_params(manifest.scope, manifest.run_id)
    row = (await conn.execute(text("""
        SELECT manifest_hash,replay_cursor_at FROM simulation_runs
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().first()
    if row is None or row["manifest_hash"] != manifest.manifest_hash or \
            row["replay_cursor_at"] != current or \
            not manifest.scenario.simulation_cursor_at <= current <= \
            manifest.scenario.simulation_end_at:
        raise FinanceError("next source cursor differs from durable replay checkpoint")
    future = (event.simulation_cursor_at for event in
              await _simulated(conn, manifest, params)
              if event.simulation_cursor_at > current)
    return min(future, default=None)


async def materialize_run_events(conn, manifest: SimulationRunManifest, *,
                                 read_only: bool = False
                                 ) -> tuple[ExecutionEvent, ...]:
    """Append all due facts and return their global chronological prefix.

    The default caller holds the scoped finance/run writer lock and appends missing
    facts. Read-only callers require the persisted due prefix to be complete.
    """
    if manifest.scope.environment != "experiment":
        raise FinanceError("source replay requires an experiment run")
    params = _run_params(manifest.scope, manifest.run_id)
    lock = "" if read_only else " FOR UPDATE"
    run = (await conn.execute(text("""
        SELECT manifest_hash,manifest_json,replay_cursor_at FROM simulation_runs
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """ + lock), params)).mappings().first()
    if run is None or run["manifest_hash"] != manifest.manifest_hash or \
            SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"])) \
            != manifest or \
            run["replay_cursor_at"] is None:
        raise FinanceError("source replay run or durable cursor differs")
    cursor: datetime = _utc(run["replay_cursor_at"])
    if not manifest.scenario.simulation_cursor_at <= cursor <= \
            manifest.scenario.simulation_end_at:
        raise FinanceError("durable replay cursor is outside frozen scenario")
    expected = await _simulated(conn, manifest, params, read_only=read_only)
    expected_by_order: dict[str, list[ExecutionEvent]] = defaultdict(list)
    for event in expected:
        expected_by_order[event.order_id].append(event)
    for values in expected_by_order.values():
        values.sort(key=lambda item: (item.simulation_cursor_at, item.sequence,
                                      item.source_event_id))
    rows = (await conn.execute(text("""
        SELECT order_id,event_hash,source_stream,source_event_id,source_revision,
               sequence,kind,event_at,available_at,simulation_cursor_at,event_json
        FROM simulation_order_events WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        AND run_id=:run_id ORDER BY order_id,simulation_cursor_at,sequence,
                                   source_event_id
    """), params)).mappings().all()
    stored: dict[str, list[ExecutionEvent]] = defaultdict(list)
    for row in rows:
        event = ExecutionEvent.model_validate_json(json.dumps(row["event_json"]))
        if any((event.event_hash != row["event_hash"],
                event.source_stream != row["source_stream"],
                event.source_event_id != row["source_event_id"],
                event.source_revision != row["source_revision"],
                event.sequence != row["sequence"], event.kind != row["kind"],
                event.event_at != row["event_at"],
                event.available_at != row["available_at"],
                event.simulation_cursor_at != row["simulation_cursor_at"])) or \
                event.simulation_cursor_at > cursor:
            raise FinanceError("stored simulation source event differs or arrives early")
        stored[row["order_id"]].append(event)
    for key, previous in stored.items():
        due = [event for event in expected_by_order.get(key, ())
               if event.simulation_cursor_at <= cursor]
        if previous != due[:len(previous)]:
            raise FinanceError("persisted source events are not a simulation prefix")
    if read_only:
        for key, events in expected_by_order.items():
            due = [event for event in events if event.simulation_cursor_at <= cursor]
            if stored.get(key, []) != due:
                raise FinanceError("read-only replay source prefix is incomplete")
        return tuple(event for event in expected if event.simulation_cursor_at <= cursor)
    for key, events in expected_by_order.items():
        due = [event for event in events if event.simulation_cursor_at <= cursor]
        for event in due[len(stored[key]):]:
            await conn.execute(text("""
            INSERT INTO simulation_order_events(environment,scope_id,strategy_account_id,
              run_id,order_id,event_hash,source_stream,source_event_id,source_revision,
              sequence,kind,event_at,available_at,simulation_cursor_at,event_json)
            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:order_id,
              :event_hash,:source_stream,:source_event_id,:source_revision,:sequence,
              :kind,:event_at,:available_at,:simulation_cursor_at,CAST(:event_json AS jsonb))
            """), {**params, "order_id": event.order_id,
               "event_hash": event.event_hash, "source_stream": event.source_stream,
               "source_event_id": event.source_event_id,
               "source_revision": event.source_revision, "sequence": event.sequence,
               "kind": event.kind, "event_at": event.event_at,
               "available_at": event.available_at,
               "simulation_cursor_at": event.simulation_cursor_at,
               "event_json": json.dumps(event.model_dump(mode="json"),
                                        sort_keys=True, separators=(",", ":"),
                                        ensure_ascii=False)})
    return tuple(event for event in expected if event.simulation_cursor_at <= cursor)


async def materialize_order_events(conn, manifest: SimulationRunManifest,
                                   order_id: str) -> tuple[ExecutionEvent, ...]:
    """Compatibility read of one order after globally materializing due facts."""
    if not order_id:
        raise FinanceError("source replay target has no order identity")
    params = _run_params(manifest.scope, manifest.run_id)
    if order_id not in {item.order_id for item in await _permits(conn, manifest, params)}:
        raise FinanceError("source replay target has no submitted permit")
    return tuple(event for event in await materialize_run_events(conn, manifest)
                 if event.order_id == order_id)
