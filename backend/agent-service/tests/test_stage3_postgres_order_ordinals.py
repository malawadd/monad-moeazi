"""Real restricted SQL ordinal allocation is serialized and retry-stable."""
import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.lifecycle_order_ordinals import allocate_order_ordinal
from test_lifecycle_preparation_postgres import guarded_dsn, setup
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_entry_and_close_allocations_share_one_durable_run_sequence():
    broad = create_async_engine(guarded_dsn(), pool_size=1, max_overflow=0)
    narrow = create_async_engine(qualification()["dsn"], pool_size=3, max_overflow=0)
    try:
        _, _, run, _, _ = await setup(broad)

        async def allocate(kind, key):
            async with narrow.begin() as conn:
                return await allocate_order_ordinal(conn, run.scope, run.run_id,
                                                    run.manifest_hash, kind, key)

        first_key = f"owner-{uuid4()}"
        same = await asyncio.gather(*(allocate("maintenance", first_key)
                                      for _ in range(2)))
        assert same == [1, 1]
        keys = [("entry", f"entry-{uuid4()}"),
                ("maintenance", f"owner-{uuid4()}"),
                ("entry", f"entry-{uuid4()}")]
        later = await asyncio.gather(*(allocate(kind, key) for kind, key in keys))
        assert sorted(later) == [2, 3, 4]
        assert await allocate("maintenance", first_key) == 1
        assert [await allocate(kind, key) for kind, key in keys] == later
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            rows = (await conn.execute(text("""
                SELECT allocation_kind,allocation_key,order_ordinal
                FROM simulation_order_ordinal_allocations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().all()
        assert len(rows) == 4
        assert {row["order_ordinal"] for row in rows} == {1, 2, 3, 4}
        assert len({(row["allocation_kind"], row["allocation_key"])
                    for row in rows}) == 4
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_allocated_ordinal_cannot_be_reused_or_mutated():
    broad = create_async_engine(guarded_dsn(), pool_size=1, max_overflow=0)
    narrow = create_async_engine(qualification()["dsn"], pool_size=1, max_overflow=0)
    try:
        _, _, run, _, _ = await setup(broad)
        async with narrow.begin() as conn:
            first = await allocate_order_ordinal(conn, run.scope, run.run_id,
                run.manifest_hash, "entry", f"initial-{uuid4()}")
        assert first == 1
        params = {**run.scope.model_dump(), "run_id": run.run_id,
                  "manifest": run.manifest_hash}
        async with narrow.connect() as conn:
            transaction = await conn.begin()
            try:
                with pytest.raises(Exception, match="duplicate key|ordinal collides"):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            INSERT INTO simulation_order_ordinal_allocations(
                              environment,scope_id,strategy_account_id,run_id,
                              manifest_hash,allocation_kind,allocation_key,order_ordinal)
                            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                              :manifest,'maintenance',:key,1)
                        """), {**params, "key": f"collision-{uuid4()}"})
                with pytest.raises(Exception, match="frozen run"):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            INSERT INTO simulation_order_ordinal_allocations(
                              environment,scope_id,strategy_account_id,run_id,
                              manifest_hash,allocation_kind,allocation_key,order_ordinal)
                            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                              :manifest,'maintenance',:key,2)
                        """), {**params, "manifest": "0" * 64,
                                "key": f"wrong-manifest-{uuid4()}"})
                with pytest.raises(Exception, match="permission denied"):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            UPDATE simulation_order_ordinal_allocations
                            SET order_ordinal=9 WHERE environment=:environment
                              AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id
                        """), params)
            finally:
                await transaction.rollback()
        async with narrow.connect() as conn:
            ordinals = (await conn.execute(text("""
                SELECT order_ordinal FROM simulation_order_ordinal_allocations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalars().all()
        assert ordinals == [1]
    finally:
        await narrow.dispose()
        await broad.dispose()
