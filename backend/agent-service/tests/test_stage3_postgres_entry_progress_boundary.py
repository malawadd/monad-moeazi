"""Independent SQL066 progress identity checks on the disposable Q4 database."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_entry_progress import (
    load_entry_progress, store_entry_progress,
)
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_entry_processor_postgres import prepare
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_progress_recovery_freezes_payload_and_rejects_oversize_or_tamper():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, _, _ = await prepare(broad, narrow, hold=True)
        scope = run.scope
        async with narrow.connect() as conn:
            tx = await conn.begin()
            try:
                first = {"decision": "hold", "reasons": ["price_above_threshold"]}
                digest = await store_entry_progress(conn, scope, run.run_id,
                    run.manifest_hash, "request-a", "evaluation", first)
                assert len(digest) == 64
                assert await load_entry_progress(conn, scope, run.run_id,
                    run.manifest_hash, "request-a", "evaluation") == first
                same = {"reasons": ["price_above_threshold"], "decision": "hold"}
                assert await store_entry_progress(conn, scope, run.run_id,
                    run.manifest_hash, "request-a", "evaluation", same) == digest
                with pytest.raises(FinanceError, match="cannot be replaced"):
                    await store_entry_progress(conn, scope, run.run_id,
                        run.manifest_hash, "request-a", "evaluation",
                        {"decision": "enter"})
                with pytest.raises(FinanceError, match="bounded payload"):
                    await store_entry_progress(conn, scope, run.run_id,
                        run.manifest_hash, "request-b", "evaluation",
                        {"message": "😀" * 17_000})
                with pytest.raises(ValueError):
                    await store_entry_progress(conn, scope, run.run_id,
                        run.manifest_hash, "request-b", "evaluation",
                        {"unrepresentable": float("nan")})
                assert await load_entry_progress(conn, scope, run.run_id,
                    run.manifest_hash, "request-b", "evaluation") is None
                params = {**scope.model_dump(), "run_id": run.run_id,
                    "request_id": "request-a"}
                with pytest.raises(Exception):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            UPDATE simulation_entry_progress
                            SET payload_json='{"decision":"enter"}'::jsonb
                            WHERE environment=:environment AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id AND request_id=:request_id
                        """), params)
                with pytest.raises(Exception):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            DELETE FROM simulation_entry_progress
                            WHERE environment=:environment AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id AND request_id=:request_id
                        """), params)
            finally:
                await tx.rollback()
    finally:
        await narrow.dispose()
        await broad.dispose()
