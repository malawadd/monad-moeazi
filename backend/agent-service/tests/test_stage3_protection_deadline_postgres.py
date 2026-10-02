"""A real folded protection obligation wakes historical replay without new books."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_contracts import ProtectionRequirement, TradeIntent
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from moeazi_agent.lifecycle_protection_supervisor import DEADLINE_REASON
from test_lifecycle_preparation_postgres import guarded_dsn, setup
from test_stage3_lifecycle_contracts import seal
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_deadline_advances_without_fabricating_market_evidence():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        initial, _, run, original, held = await setup(broad)
        body = {name: getattr(original, name) for name in TradeIntent.model_fields
                if name != "intent_hash"}
        body["protection"] = ProtectionRequirement(required=True,
            policy_version=run.policy_version, policy_hash=run.policy_hash,
            maximum_unprotected_seconds=1, on_rejection="hold_and_escalate")
        intent = seal(TradeIntent, "moeazi-trade-intent-v1", "intent_hash", body)
        await initial.persist_intent(intent)
        prepared = await initial.prepare_order(intent, held["reservationId"], 1,
            worker_id="stage2-verifier", command_id="deadline-prepare")
        approval = await initial.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=30), "deadline-approve")
        await initial.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", approval_receipt_hash=approval["approvalReceiptHash"])
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        first = await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="due-entry-source")
        assert first["advanced"]
        await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id="fold-entry")
        await repo.reconcile_replay_checkpoint(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="entry-checkpoint")
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_order_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            obligation = (await conn.execute(text("""
                SELECT intended_json FROM simulation_protections WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        next_step = await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="due-protection")
        expected = datetime.fromisoformat(obligation["deadline_at_cursor"].replace("Z", "+00:00"))
        assert next_step["advanced"] and next_step["nextCursorAt"] == expected
        assert expected == first["nextCursorAt"] + timedelta(seconds=1)
        duplicate = await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="due-protection")
        assert duplicate["duplicate"] and duplicate["nextCursorAt"] == expected
        deadline_command = PhaseCommand(run.scope, run.run_id, run.manifest_hash,
            "supervise-due-protection", "protection", {"entriesInhibited": False})
        result = await repo.process_protection_deadlines(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", phase_command=deadline_command)
        assert result["stoppedEntries"] and result["escalatedCount"] == 1
        assert result["exposureClosed"] is False and result["holdsReleased"] is False
        assert await repo.process_protection_deadlines(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", phase_command=deadline_command) == result
        async with narrow.connect() as conn:
            assert (await conn.execute(text("""
                SELECT count(*) FROM simulation_order_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() == count
            assert (await conn.execute(text("""
                SELECT status FROM simulation_protections WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() == "intended"
            assert (await conn.execute(text("""
                SELECT reason FROM simulation_protections WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() == DEADLINE_REASON
            assert (await conn.execute(text("""
                SELECT status FROM finance_reservations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation
            """), {**params, "reservation": held["reservationId"]})).scalar_one() == "submitted"
            assert (await conn.execute(text("""
                SELECT entries_stopped FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() is True
    finally:
        await narrow.dispose()
        await broad.dispose()
