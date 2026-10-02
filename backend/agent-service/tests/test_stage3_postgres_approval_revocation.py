"""Actual SQL approval lineage: revocation cannot fall back to an older receipt."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_revoked_latest_receipt_also_invalidates_older_parallel_receipt():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare")
        expiry = datetime.now(timezone.utc) + timedelta(seconds=45)

        async def approve(command_id):
            return await repo.record_simulation_approval(run.scope, run.run_id,
                run.manifest_hash, intent.intent_id,
                prepared["normalizedPayloadHash"], "verified-owner", expiry,
                command_id)

        older = await approve("approve-older")
        latest = await approve("approve-latest")
        assert older["approvalReceiptHash"] != latest["approvalReceiptHash"]
        await repo.revoke_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, latest["approvalReceiptHash"], "verified-owner")
        async with engine.connect() as conn:
            revoked = (await conn.execute(text("""
                SELECT approval_hash FROM simulation_approval_revocations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalars().all()
            assert set(revoked) == {
                older["approvalReceiptHash"], latest["approvalReceiptHash"]}
        for receipt in (older, latest):
            with pytest.raises(FinanceError, match="expired or differs"):
                await repo.start_order(run.scope, run.run_id, prepared["orderId"],
                    worker_id="stage2-verifier",
                    approval_receipt_hash=receipt["approvalReceiptHash"])
        renewed = await approve("approve-new-after-revoke")
        assert renewed["approvalReceiptHash"] not in revoked
        assert (await repo.revoke_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, latest["approvalReceiptHash"],
            "verified-owner"))["status"] == "revoked"
        async with engine.connect() as conn:
            new_revocations = (await conn.execute(text("""
                SELECT approval_hash FROM simulation_approval_revocations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalars().all()
            assert renewed["approvalReceiptHash"] not in new_revocations
        started = await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=renewed["approvalReceiptHash"])
        assert started["status"] == "submission_possible"
    finally:
        await engine.dispose()
