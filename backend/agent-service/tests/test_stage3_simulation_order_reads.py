"""Actual scoped PostgreSQL order review, using synthetic unfunded portfolios."""
import json
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_order_reads import read_prepared_orders
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_prepared_review_binds_owner_payload_and_cursor_without_financial_mutation():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, finance, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-review")
        before = await finance.read_account_risk_snapshot(run.scope)
        result = await read_prepared_orders(repo, run.scope, run.run_id,
                                           run.manifest_hash, "verified-owner")
        assert result["authority"] == "review_only" and result["requiresFreshAdmission"]
        assert len(result["items"]) == 1 and result["nextAfterOrdinal"] is None
        item = result["items"][0]
        assert item["normalizedPayloadHash"] == prepared["normalizedPayloadHash"]
        assert item["payload"]["quantityUnits"] == "1000000"
        assert item["payload"]["scope"] == run.scope.model_dump(mode="json")
        assert item["orderStatus"] == "not_submitted"
        assert item["reservationStatus"] == "reserved"
        assert (await read_prepared_orders(repo, run.scope, run.run_id,
            run.manifest_hash, "verified-owner", after_ordinal=1))["items"] == []
        for subject, digest in (("foreign-owner", run.manifest_hash),
                                ("verified-owner", "f" * 64)):
            with pytest.raises(FinanceError):
                await read_prepared_orders(repo, run.scope, run.run_id, digest, subject)
        after = await finance.read_account_risk_snapshot(run.scope)
        assert after["accountRevision"] == before["accountRevision"]

        checkpoint = Path(__file__).resolve().parents[2] / ".data" / "q4-simulation-db.json"
        if checkpoint.exists():
            record = json.loads(checkpoint.read_text(encoding="utf-8"))
            from test_stage3_simulation_database_role import guarded_dsn as role_dsn
            narrow = create_async_engine(role_dsn(record["dsn"], record["role"]))
            try:
                restricted = SimulationLifecycleRepository(FinanceRepository(narrow),
                                                           simulator=simulate_order)
                second = await read_prepared_orders(restricted, run.scope, run.run_id,
                                                   run.manifest_hash, "verified-owner")
                assert second["items"] == result["items"]
            finally:
                await narrow.dispose()
    finally:
        await engine.dispose()
