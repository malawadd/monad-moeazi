"""A genuine folded fill cannot be made flat by invented SQL073 state."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_protection_origin import _required_entry
from test_stage3_simulation_database_role import qualification


H = "a" * 64


@pytest.mark.asyncio
async def test_real_increasing_fill_rejects_invented_flat_proof_link_and_completion():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        result = await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"fold-{uuid4()}")
        assert result["foldedCount"] >= 2
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.begin() as conn:
            account = (await conn.execute(text("""
                SELECT revision,observation_snapshot_hash FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            stored = (await conn.execute(text("""
                SELECT replay_cursor_at FROM simulation_runs
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().one()
            position = (await conn.execute(text("""
                SELECT instrument_version_id,location_id,signed_exposure_units,
                  pending_obligations FROM simulation_positions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().one()
            assert position["signed_exposure_units"] > 0
            assert position["pending_obligations"]
            proof = f"{uuid4().hex}{uuid4().hex}"
            command = f"invented-{uuid4()}"
            body = {"scope": run.scope.model_dump(mode="json"),
                "runId": run.run_id, "instrumentVersionId": position["instrument_version_id"],
                "commandId": command, "manifestHash": run.manifest_hash,
                "resolutionHash": proof, "accountRevision": account["revision"],
                "accountSnapshotHash": account["observation_snapshot_hash"],
                "replayCursorAt": stored["replay_cursor_at"].isoformat(),
                "sourceRoot": H, "journalRoot": H, "positionRoot": H,
                "positions": [], "obligationIntendedHashes": [],
                "reservationResolutionHashes": []}
            with pytest.raises(Exception, match="current clean source checkpoint"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        INSERT INTO simulation_flat_resolutions(
                          environment,scope_id,strategy_account_id,run_id,
                          instrument_version_id,command_id,manifest_hash,resolution_hash,
                          account_revision,account_snapshot_hash,replay_cursor_at,
                          source_root,journal_root,position_root,proof_json)
                        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                          :instrument,:command,:manifest,:proof,:revision,:snapshot,
                          :cursor,:source,:journal,:position,CAST(:body AS jsonb))
                    """), {**params, "instrument": position["instrument_version_id"],
                        "command": command, "manifest": run.manifest_hash,
                        "proof": proof, "revision": account["revision"],
                        "snapshot": account["observation_snapshot_hash"],
                        "cursor": stored["replay_cursor_at"], "source": H,
                        "journal": H, "position": H, "body": json.dumps(body)})
            with pytest.raises(Exception, match="lacks its exact flat proof"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        UPDATE simulation_protections SET resolution_hash=:proof
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    """), {**params, "proof": proof})
            with pytest.raises(Exception, match="completion lacks current flat source proof"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        UPDATE simulation_positions SET pending_obligations=false
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    """), params)
            state = (await conn.execute(text("""
                SELECT p.pending_obligations,q.resolution_hash FROM simulation_positions p
                JOIN simulation_protections q USING(environment,scope_id,strategy_account_id,run_id)
                WHERE p.environment=:environment AND p.scope_id=:scope_id
                  AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
            """), params)).mappings().one()
            assert state["pending_obligations"] and state["resolution_hash"] is None
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_flat_resolution_command_stays_noop_with_real_open_exposure():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"fold-{uuid4()}")
        command = f"flat-attempt-{uuid4()}"
        first = await repo.resolve_flat_positions(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=command)
        assert first["resolved"] is False
        duplicate = await repo.resolve_flat_positions(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=command)
        assert duplicate == first
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_flat_resolutions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            position = (await conn.execute(text("""
                SELECT signed_exposure_units,pending_obligations
                FROM simulation_positions WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)).mappings().one()
        assert count == 0
        assert position["signed_exposure_units"] > 0 and position["pending_obligations"]
    finally:
        await narrow.dispose()
        await broad.dispose()
