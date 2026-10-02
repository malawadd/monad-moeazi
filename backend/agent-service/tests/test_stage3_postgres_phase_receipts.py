"""Actual disposable Q4 SQL checks for exact, immutable activity substep receipts."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.lifecycle_phase_receipts import (
    PhaseCommand, load_phase_receipt, store_phase_receipt,
)
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted
from test_stage3_simulation_database_role import qualification


def _params(run):
    return {**run.scope.model_dump(), "run_id": run.run_id}


@pytest.mark.asyncio
async def test_phase_receipt_replays_original_unicode_noop_and_rejects_changed_identity():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, _ = await submitted(broad)
        key = f"phase-{uuid4()}"
        command = PhaseCommand(run.scope, run.run_id, run.manifest_hash, key,
            "controls", {"entriesInhibited": True, "note": "اختبار 🚀"})
        original = {"dispatchedCount": 0, "resolvedCount": 0,
                    "projectionRevision": "9007199254740993"}
        async with narrow.begin() as conn:
            await conn.execute(text("""
                SELECT projection_revision FROM simulation_runs
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                FOR UPDATE
            """), _params(run))
            assert await store_phase_receipt(conn, command, original) == original
        # A separate API/control change cannot re-run an already committed no-op.
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET projection_revision=projection_revision+1
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), _params(run))
        async with narrow.begin() as conn:
            assert await load_phase_receipt(conn, command) == original
            assert await store_phase_receipt(conn, command, original) == original
            with pytest.raises(FinanceError, match="replaced"):
                await store_phase_receipt(conn, command, {**original, "resolvedCount": 1})
            changed = PhaseCommand(run.scope, run.run_id, run.manifest_hash, key,
                "controls", {"entriesInhibited": False, "note": "اختبار 🚀"})
            with pytest.raises(FinanceError, match="identity"):
                await load_phase_receipt(conn, changed)
            for action in (
                "UPDATE simulation_phase_receipts SET result_json='{}'::jsonb",
                "DELETE FROM simulation_phase_receipts",
            ):
                with pytest.raises(Exception):
                    async with conn.begin_nested():
                        await conn.execute(text(action + " WHERE environment=:environment"
                            " AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id"
                            " AND run_id=:run_id AND command_id=:command_id"),
                            {**_params(run), "command_id": key})
        async with narrow.connect() as conn:
            assert await load_phase_receipt(conn, command) == original
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_phase_receipt_rejects_forged_hash_and_live_scope_at_sql_boundary():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, _ = await submitted(broad)
        key = f"phase-{uuid4()}"
        command = PhaseCommand(run.scope, run.run_id, run.manifest_hash, key,
                               "fold", {"order": "one"})
        # A direct SQL row with format-valid but false hashes may exist, yet
        # the read boundary must never accept it as a completed phase.
        async with narrow.connect() as conn:
            async with conn.begin():
                await conn.execute(text("""
                    INSERT INTO simulation_phase_receipts(environment,scope_id,
                      strategy_account_id,run_id,command_id,phase,manifest_hash,
                      input_hash,inputs_json,result_hash,result_json)
                    VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                      :command_id,'fold',:manifest_hash,:hash,
                      CAST(:inputs AS jsonb),:hash,CAST(:result AS jsonb))
                """), {**_params(run), "command_id": key,
                       "manifest_hash": run.manifest_hash, "hash": "a" * 64,
                       "inputs": json.dumps(command.inputs), "result": "{}"})
                with pytest.raises(FinanceError, match="identity"):
                    await load_phase_receipt(conn, command)
                # Roll back the intentionally forged row; the test leaves no
                # false receipt for a later disposable qualification run.
                await conn.rollback()
        live = FinanceScope(environment="live", scope_id="live",
                            strategy_account_id=run.scope.strategy_account_id)
        with pytest.raises(FinanceError, match="Invalid"):
            PhaseCommand(live, run.run_id, run.manifest_hash, key,
                         "fold").identity()
        async with narrow.begin() as conn:
            with pytest.raises(Exception):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        INSERT INTO simulation_phase_receipts(environment,scope_id,
                          strategy_account_id,run_id,command_id,phase,manifest_hash,
                          input_hash,inputs_json,result_hash,result_json)
                        VALUES('live','live',:account,:run,:command,'fold',:manifest,
                          :hash,'{}'::jsonb,:hash,'{}'::jsonb)
                    """), {"account": run.scope.strategy_account_id, "run": run.run_id,
                           "command": key, "manifest": run.manifest_hash,
                           "hash": "a" * 64})
    finally:
        await narrow.dispose()
        await broad.dispose()
