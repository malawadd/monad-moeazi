"""Atomic replay source and journal fold on the disposable Q4 database."""
from datetime import datetime, timedelta, timezone
import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import db_native_int
from moeazi_agent.finance_observation_contracts import account_snapshot_from_row
from moeazi_agent.lifecycle_checkpoint_oracle import reconstruct_replay_account
from moeazi_agent.lifecycle_checkpoint_builder import build_derived_account_snapshot
from moeazi_agent.lifecycle_checkpoint_verify import verify_replay_checkpoint
from moeazi_agent.lifecycle_contracts import ExecutionEvent, ExecutionPermit
from moeazi_agent.observation_contracts import InstrumentVersion
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_replay_cursor_claim_never_skips_a_later_order_after_noop():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        idle = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-idle")
        assert idle["advanced"] is False
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-cursor")
        approval = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=30),
            "approve-cursor")
        await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=approval["approvalReceiptHash"])
        old_retry = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-idle")
        assert old_retry["duplicate"] and not old_retry["advanced"]
        stepped = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-step")
        assert stepped["advanced"] is True
        assert stepped["nextCursorAt"] > stepped["previousCursorAt"]
        retry = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-step")
        assert retry["duplicate"] and retry["nextCursorAt"] == stepped["nextCursorAt"]
        progressed = await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "worker-phase-1")
        assert progressed.next_action == "advance"
        replayed = await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "worker-phase-1")
        assert replayed == progressed
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_initial_due_facts_fold_without_claiming_fill_completion():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-fold")
        approval = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=30),
            "approve-fold")
        started = await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=approval["approvalReceiptHash"])
        assert started["status"] == "submission_possible"
        # The disposable harness advances the stored replay clock through its
        # immutable scenario window; production advances from source events.
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                   "cursor": run.scenario.simulation_end_at})
        result = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id="fold-1")
        duplicate = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id="fold-1")
        assert result["foldedCount"] >= 1
        assert duplicate["foldedCount"] == 0
        async with engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT o.status,o.cumulative_filled_units,
                  (SELECT count(*) FROM simulation_order_events e
                   WHERE e.environment=o.environment AND e.scope_id=o.scope_id
                     AND e.strategy_account_id=o.strategy_account_id
                     AND e.run_id=o.run_id AND e.order_id=o.order_id) source_count,
                  (SELECT count(*) FROM simulation_event_folds f
                   WHERE f.environment=o.environment AND f.scope_id=o.scope_id
                     AND f.strategy_account_id=o.strategy_account_id
                     AND f.run_id=o.run_id AND f.order_id=o.order_id) fold_count,
                  (SELECT count(*) FROM simulation_order_events e
                   WHERE e.environment=o.environment AND e.scope_id=o.scope_id
                     AND e.strategy_account_id=o.strategy_account_id
                     AND e.run_id=o.run_id AND e.order_id=o.order_id
                     AND e.kind='fill') fill_count,
                  (SELECT count(*) FROM simulation_event_journal_links j
                   WHERE j.environment=o.environment AND j.scope_id=o.scope_id
                     AND j.strategy_account_id=o.strategy_account_id
                     AND j.run_id=o.run_id) journal_count,
                  (SELECT count(*) FROM simulation_positions p
                   WHERE p.environment=o.environment AND p.scope_id=o.scope_id
                     AND p.strategy_account_id=o.strategy_account_id
                     AND p.run_id=o.run_id) position_count
                FROM simulation_orders o WHERE o.environment=:environment
                  AND o.scope_id=:scope_id AND o.strategy_account_id=:strategy_account_id
                  AND o.run_id=:run_id AND o.order_id=:order_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                   "order_id": prepared["orderId"]})).mappings().one()
        assert row["source_count"] == row["fold_count"]
        assert row["fill_count"] == row["journal_count"] >= 1
        assert row["position_count"] == 1
        assert row["status"] in {"accepted", "partially_filled", "filled"}
        async with engine.connect() as conn:
            baseline_row = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": run.account_snapshot_hash})).mappings().one()
            source_rows = (await conn.execute(text("""
                SELECT event_json FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                ORDER BY simulation_cursor_at,order_id,sequence
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalars().all()
            permit_json = (await conn.execute(text("""
                SELECT permit_json FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                   "order_id": prepared["orderId"]})).scalar_one()
            instrument_row = (await conn.execute(text("""
                SELECT manifest FROM observation_instrument_versions
                WHERE instrument_version_id=:id
            """), {"id": run.instrument_version_ids[0]})).scalar_one()
            ledger_rows = (await conn.execute(text("""
                SELECT asset_unit_id,registry_hash,location_id,book,units
                FROM finance_balances WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).mappings().all()
        oracle = reconstruct_replay_account(account_snapshot_from_row(baseline_row),
            tuple(ExecutionEvent.model_validate_json(json.dumps(body))
                  for body in source_rows),
            (ExecutionPermit.model_validate_json(json.dumps(permit_json)),),
            (InstrumentVersion.model_validate(instrument_row),),
            {run.instrument_version_ids[0]: 1000})
        actual = {(item["asset_unit_id"], item["registry_hash"],
                   item["location_id"], item["book"]): db_native_int(item["units"])
                  for item in ledger_rows}
        assert {key: value for key, value in oracle.balances.items() if value} == \
            {key: value for key, value in actual.items() if value}
        async with engine.connect() as conn:
            account = (await conn.execute(text("""
                SELECT * FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).mappings().one()
            run_row = (await conn.execute(text("""
                SELECT * FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).mappings().one()
            checked, facts = await verify_replay_checkpoint(
                conn, run.scope, run, run_row, account)
        assert checked.source_root == oracle.source_root
        assert len(facts) == row["source_count"]
        derived = build_derived_account_snapshot(
            account_snapshot_from_row(baseline_row), checked, facts,
            scope=run.scope, run_id=run.run_id, manifest_hash=run.manifest_hash,
            policy_version=run.policy_version,
            replay_cursor_at=run_row["replay_cursor_at"])
        assert derived.origin == "simulation_derived"
        assert derived.snapshot_hash != run.account_snapshot_hash
        reconciled = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="checkpoint-fold")
        assert reconciled["snapshotHash"] == derived.snapshot_hash
        assert reconciled["status"] in {"clean", "quarantined"}
        duplicate_checkpoint = await repo.reconcile_replay_checkpoint(
            run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="checkpoint-fold")
        assert duplicate_checkpoint["duplicate"] is True
        assert duplicate_checkpoint["revision"] == reconciled["revision"]
    finally:
        await engine.dispose()
