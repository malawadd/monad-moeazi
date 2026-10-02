"""SQL067 boundary checks on the explicitly opted-in disposable Q4 database.

These checks do not certify an economic checkpoint writer. In particular, SQL
cannot reconstruct the source/journal/position roots from immutable facts.
"""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from test_lifecycle_preparation_postgres import guarded_dsn, setup


async def rejected(conn, sql, values):
    with pytest.raises(Exception):
        async with conn.begin_nested():
            await conn.execute(text(sql), values)


CLONE = """
INSERT INTO observation_account_snapshots (
  snapshot_hash,environment,scope_id,strategy_account_id,source_account_id,
  status,origin,observed_balances,observed_positions,balances_complete,
  positions_complete,event_at,available_at,received_at,cutoff_at,finality,
  finality_at,has_gap,has_reorg,rights_ref,source_event_hash,
  source_payload_hash,policy_version,registry_hash)
SELECT :hash,:environment,scope_id,strategy_account_id,source_account_id,
  :status,'simulation_derived',observed_balances,observed_positions,
  balances_complete,positions_complete,event_at,available_at,received_at,
  :cursor,:finality,event_at,:has_gap,false,:rights,
  source_event_hash,source_payload_hash,policy_version,registry_hash
FROM observation_account_snapshots WHERE snapshot_hash=:baseline
"""

LINK = """
INSERT INTO simulation_derived_snapshots (
  environment,scope_id,strategy_account_id,run_id,snapshot_hash,
  manifest_hash,baseline_snapshot_hash,replay_cursor_at,source_root,
  journal_root,position_root)
VALUES (:environment,:scope_id,:strategy_account_id,:run_id,:hash,
        :manifest,:baseline,:cursor,:source,:journal,:position)
"""


@pytest.mark.asyncio
async def test_derived_checkpoint_scope_finality_and_same_cursor_identity():
    engine = create_async_engine(guarded_dsn())
    try:
        _, _, run, _, _ = await setup(engine)
        async with engine.connect() as conn:
            tx = await conn.begin()
            try:
                cursor = (await conn.execute(text("""
                    SELECT replay_cursor_at FROM simulation_runs
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), {**run.scope.model_dump(), "run_id": run.run_id})).scalar_one()
                base = dict(run.scope.model_dump(), run_id=run.run_id,
                    baseline=run.account_snapshot_hash, cursor=cursor,
                    manifest=run.manifest_hash, source="1" * 64,
                    journal="2" * 64, position="3" * 64)
                clone = dict(base, environment="experiment", status="accepted",
                    finality="admitted_final", has_gap=False,
                    rights="local_simulation_fixture_only", hash=uuid4().hex * 2)
                for override in (
                    {"environment": "live"}, {"status": "quarantined"},
                    {"finality": "pending"}, {"has_gap": True},
                    {"rights": "internal_qualification_only"},
                ):
                    await rejected(conn, CLONE, clone | override |
                                   {"hash": uuid4().hex * 2})
                await conn.execute(text(CLONE), clone)
                await rejected(conn, LINK, base | {"hash": clone["hash"],
                    "environment": "live"})
                await rejected(conn, LINK, base | {"hash": clone["hash"],
                    "scope_id": "foreign-scope"})
                await rejected(conn, LINK, base | {"hash": clone["hash"],
                    "baseline": "4" * 64})
                await rejected(conn, LINK, base | {"hash": clone["hash"],
                    "cursor": cursor.replace(year=cursor.year - 1)})
                await conn.execute(text(LINK), base | {"hash": clone["hash"]})
                second = clone | {"hash": uuid4().hex * 2}
                await conn.execute(text(CLONE), second)
                await conn.execute(text(LINK), base | {"hash": second["hash"]})
                count = (await conn.execute(text("""
                    SELECT count(*) FROM simulation_derived_snapshots
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id AND replay_cursor_at=:cursor
                """), base)).scalar_one()
                assert count == 2
                await rejected(conn, """
                    UPDATE simulation_derived_snapshots SET source_root=:changed
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id AND snapshot_hash=:hash
                """, base | {"hash": clone["hash"], "changed": "5" * 64})
                await rejected(conn, """
                    DELETE FROM simulation_derived_snapshots
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id AND snapshot_hash=:hash
                """, base | {"hash": clone["hash"]})
            finally:
                await tx.rollback()
    finally:
        await engine.dispose()
