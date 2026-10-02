"""Rollback-only adversary: SQL073 must not trust a rewritten position projection."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import _digest
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_position_math_contracts import PositionArithmeticState
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_protection_origin import _required_entry
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_rewritten_flat_position_cannot_outvote_real_fold_and_checkpoint():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"fold-{uuid4()}")
        await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"checkpoint-{uuid4()}")
        settled = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"settle-{uuid4()}")
        assert settled["settled"]
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            transaction = await conn.begin()
            try:
                account = (await conn.execute(text("""
                    SELECT revision,observation_snapshot_hash,reconciliation_state
                    FROM finance_accounts WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                    FOR UPDATE
                """), params)).mappings().one()
                assert account["reconciliation_state"] == "clean"
                position = (await conn.execute(text("""
                    SELECT * FROM simulation_positions WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id FOR UPDATE
                """), params)).mappings().one()
                assert position["signed_exposure_units"] > 0
                state = PositionArithmeticState.model_validate_json(
                    json.dumps(position["arithmetic_state_json"]))
                forged = PositionArithmeticState.model_validate(state.model_dump() | {
                    "signed_quantity_units": "0", "open_cost_numerator": "0",
                    "open_cost_denominator": "1", "margin_reserved_units": "0",
                    "collateral_units": "0"})
                state_hash = _digest("moeazi-position-arithmetic-v1",
                                     forged.model_dump(mode="json"))
                await conn.execute(text("""
                    UPDATE simulation_positions SET signed_exposure_units=0,
                      cost_basis_numerator=0,cost_basis_denominator=1,
                      arithmetic_state_json=CAST(:body AS jsonb),
                      arithmetic_state_hash=:hash,revision=revision+1
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), {**params, "body": json.dumps(forged.model_dump(mode="json")),
                        "hash": state_hash})
                position = (await conn.execute(text("""
                    SELECT instrument_version_id,location_id,revision,
                      arithmetic_state_hash FROM simulation_positions
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), params)).mappings().one()
                source = (await conn.execute(text("""
                    SELECT d.source_root,d.journal_root,d.position_root,d.replay_cursor_at
                    FROM simulation_derived_snapshots d
                    WHERE d.environment=:environment AND d.scope_id=:scope_id
                      AND d.strategy_account_id=:strategy_account_id AND d.run_id=:run_id
                      AND d.snapshot_hash=:snapshot
                """), {**params,
                    "snapshot": account["observation_snapshot_hash"]})).mappings().one()
                obligations = (await conn.execute(text("""
                    SELECT intended_hash FROM simulation_protections
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND resolution_hash IS NULL ORDER BY intended_hash
                """), params)).scalars().all()
                settlements = (await conn.execute(text("""
                    SELECT resolution_hash FROM simulation_reservation_resolutions
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    ORDER BY resolution_hash
                """), params)).scalars().all()
                assert obligations and settlements
                command = f"forged-flat-{uuid4()}"
                body = {"scope": run.scope.model_dump(mode="json"),
                    "runId": run.run_id,
                    "instrumentVersionId": position["instrument_version_id"],
                    "commandId": command, "manifestHash": run.manifest_hash,
                    "accountRevision": account["revision"],
                    "accountSnapshotHash": account["observation_snapshot_hash"],
                    "replayCursorAt": source["replay_cursor_at"].isoformat(),
                    "sourceRoot": source["source_root"],
                    "journalRoot": source["journal_root"],
                    "positionRoot": source["position_root"],
                    "positions": [{"locationId": position["location_id"],
                        "positionRevision": position["revision"],
                        "positionStateHash": position["arithmetic_state_hash"]}],
                    "obligationIntendedHashes": list(obligations),
                    "reservationResolutionHashes": list(settlements)}
                proof = _digest("moeazi-simulation-flat-resolution-v1", body)
                body["resolutionHash"] = proof
                with pytest.raises(Exception, match=
                    "flat resolution differs from immutable folded fill exposure"):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            INSERT INTO simulation_flat_resolutions(environment,scope_id,
                              strategy_account_id,run_id,instrument_version_id,command_id,
                              manifest_hash,resolution_hash,account_revision,
                              account_snapshot_hash,replay_cursor_at,source_root,journal_root,
                              position_root,proof_json)
                            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                              :instrument,:command,:manifest,:proof,:revision,:snapshot,
                              :cursor,:source,:journal,:position,CAST(:body AS jsonb))
                        """), {**params,
                            "instrument": position["instrument_version_id"],
                            "command": command, "manifest": run.manifest_hash,
                            "proof": proof, "revision": account["revision"],
                            "snapshot": account["observation_snapshot_hash"],
                            "cursor": source["replay_cursor_at"],
                            "source": source["source_root"],
                            "journal": source["journal_root"],
                            "position": source["position_root"],
                            "body": json.dumps(body)})
            finally:
                await transaction.rollback()
        async with narrow.connect() as conn:
            retained = (await conn.execute(text("""
                SELECT p.signed_exposure_units,p.pending_obligations,
                  q.resolution_hash FROM simulation_positions p
                JOIN simulation_protections q
                  USING(environment,scope_id,strategy_account_id,run_id)
                WHERE p.environment=:environment AND p.scope_id=:scope_id
                  AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
            """), params)).mappings().one()
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_flat_resolutions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert retained["signed_exposure_units"] > 0
        assert retained["pending_obligations"] and retained["resolution_hash"] is None
        assert count == 0
    finally:
        await narrow.dispose()
        await broad.dispose()
