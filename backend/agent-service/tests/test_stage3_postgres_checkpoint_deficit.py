"""A genuine second hold survives a simulated fill and blocks clean capacity."""
import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_observation_contracts import account_snapshot_from_row
from moeazi_agent.finance_policy import SizingPolicy
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage2_finance_postgres_reservations import reserve_command
from test_stage3_postgres_atomic_fold import started


@pytest.mark.asyncio
async def test_postfill_checkpoint_quarantines_remaining_submitted_and_withdrawal_holds():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, submitted = await started(engine)
        finance = repo.finance
        scope = run.scope
        params = scope.model_dump()
        async with engine.connect() as conn:
            account = (await conn.execute(text("""
                SELECT revision,writer_epoch,authority_epoch
                FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            capacity = (await conn.execute(text("""
                SELECT capacity_key,asset_unit_id,location_id,limit_units
                FROM finance_capacity WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                ORDER BY limit_units DESC LIMIT 1
            """), params)).mappings().one()
            held = (await conn.execute(text("""
                SELECT COALESCE(sum(c.units),0) FROM finance_reservation_components c
                JOIN finance_reservations r USING(environment,scope_id,
                  strategy_account_id,reservation_id)
                WHERE c.environment=:environment AND c.scope_id=:scope_id
                  AND c.strategy_account_id=:strategy_account_id
                  AND c.capacity_key=:key
                  AND r.status IN ('reserved','submitted','uncertain')
            """), params | {"key": capacity["capacity_key"]})).scalar_one()
            baseline = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots
                WHERE snapshot_hash=:hash
            """), {"hash": run.account_snapshot_hash})).mappings().one()
            policy_row = (await conn.execute(text("""
                SELECT policy_json FROM finance_policy_versions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND policy_version=:version
            """), params | {"version": run.policy_version})).scalar_one()
        available = int(capacity["limit_units"]) - int(held)
        assert available > 0
        policy = SizingPolicy.model_validate_json(json.dumps(policy_row))
        receipt = await finance.prepare_experiment_withdrawal_receipt(
            scope, account["writer_epoch"], account["revision"],
            run.policy_version, capacity["asset_unit_id"],
            capacity["location_id"], str(available))
        command = await reserve_command(engine, scope, account["writer_epoch"],
            {"authorityEpoch": account["authority_epoch"]}, policy,
            account_snapshot_from_row(baseline), receipt, purpose="withdrawal",
            team=scope.scope_id, intent=f"extra-held-{run.run_id}",
            revision=account["revision"])
        other = await finance.reserve_intent(command)
        assert other["status"] == "reserved"
        await repo.fold_order_events(scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id="deficit-fold")
        result = await repo.reconcile_replay_checkpoint(scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="deficit-checkpoint")
        assert result["status"] == "quarantined"
        assert result["reason"] == "reserved_capacity_exceeds_observed"
        async with engine.connect() as conn:
            statuses = (await conn.execute(text("""
                SELECT reservation_id,status FROM finance_reservations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND reservation_id IN (:first,:second)
            """), params | {"first": submitted["reservationId"],
                           "second": other["reservationId"]})).mappings().all()
        assert {row["reservation_id"]: row["status"] for row in statuses} == {
            submitted["reservationId"]: "submitted",
            other["reservationId"]: "reserved"}
    finally:
        await engine.dispose()
