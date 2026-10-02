"""Disposable SQL071 adversaries; only a real folded increasing fill can originate protection."""
import json
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_contracts import ProtectionRequirement, TradeIntent
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.lifecycle_source_replay import materialize_run_events
from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from moeazi_agent.lifecycle_protection_supervisor import DEADLINE_REASON
from test_lifecycle_preparation_postgres import guarded_dsn, setup
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_simulation_database_role import qualification


async def _required_entry(engine, *, advance_to_end=True):
    repo, _, run, intent, reserved = await setup(engine)
    required = ProtectionRequirement.model_validate(intent.protection.model_dump() | {
        "required": True, "maximum_unprotected_seconds": 5})
    intent = seal(TradeIntent, "moeazi-trade-intent-v1", "intent_hash",
        intent.model_dump(mode="python", exclude={"intent_hash"}) | {
            "scope": intent.scope, "controller_ref": intent.controller_ref,
            "protection": required})
    await repo.persist_intent(intent)
    prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
        worker_id="stage2-verifier", command_id=f"protection-prep-{uuid4()}")
    approval = await repo.record_simulation_approval(run.scope, run.run_id,
        run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
        "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=45),
        f"protection-approval-{uuid4()}")
    await repo.start_order(run.scope, run.run_id, prepared["orderId"],
        worker_id="stage2-verifier",
        approval_receipt_hash=approval["approvalReceiptHash"])
    params = {**run.scope.model_dump(), "run_id": run.run_id,
              "cursor": run.scenario.simulation_end_at}
    if advance_to_end:
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)
    return run, prepared["orderId"]


def _row(run, order_id, instrument, location, origin):
    protection = f"negative-{uuid4()}"
    body = {"scope": run.scope.model_dump(mode="json"),
        "run_id": run.run_id, "protection_order_id": protection,
        "originating_order_id": order_id, "originating_event_hash": origin,
        "instrument_version_id": instrument, "location_id": location,
        "policy_hash": run.policy_hash, "intended_hash": H,
        "originating_permit_hash": H, "originating_intent_hash": H,
        "position_revision": 1, "filled_quantity_units": "1000000"}
    return {**run.scope.model_dump(), "run_id": run.run_id,
        "protection": protection, "order": order_id,
        "instrument": instrument, "location": location,
        "policy": run.policy_hash, "origin": origin,
        "hash": H, "body": json.dumps(body)}


INSERT = text("""
    INSERT INTO simulation_protections(environment,scope_id,strategy_account_id,
      run_id,protection_order_id,instrument_version_id,location_id,
      originating_order_id,policy_hash,intended_hash,originating_event_hash,
      intended_json,status)
    VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:protection,
      :instrument,:location,:order,:policy,:hash,:origin,CAST(:body AS jsonb),'intended')
""")


@pytest.mark.asyncio
async def test_new_protection_requires_origin_and_rejects_nonfill_source_atomically():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        folded = await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"protection-fold-{uuid4()}")
        assert folded["foldedCount"] >= 2
        params = {**run.scope.model_dump(), "run_id": run.run_id,
                  "order": order_id}
        async with narrow.begin() as conn:
            fill = (await conn.execute(text("""
                SELECT event_hash FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND order_id=:order AND kind='fill'
            """), params)).scalar_one()
            source = (await conn.execute(text("""
                SELECT event_hash FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND order_id=:order AND kind='accepted'
            """), params)).scalar_one()
            order = (await conn.execute(text("""
                SELECT instrument_version_id,permit_json->>'location_id' location_id
                FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order
            """), params)).mappings().one()
            before = (await conn.execute(text("""
                SELECT protection_order_id,originating_event_hash,status,intended_json
                FROM simulation_protections
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().all()
            assert len(before) == 1
            assert before[0]["originating_event_hash"] == fill
            assert before[0]["status"] == "intended"
            assert before[0]["intended_json"]["originating_event_hash"] == fill
            for origin, error in ((None, "require a fill-bound preimage"),
                                  (source, "lacks its folded increasing source fill")):
                row = _row(run, order_id, order["instrument_version_id"],
                           order["location_id"], origin)
                with pytest.raises(Exception, match=error):
                    async with conn.begin_nested():
                        await conn.execute(INSERT, row)
                        await conn.execute(text(
                            "SET CONSTRAINTS simulation_protection_origin_check IMMEDIATE"))
            for statement, error in (
                ("UPDATE simulation_protections SET originating_event_hash=:source",
                 "protection origin is immutable"),
                ("DELETE FROM simulation_protections",
                 "permission denied for table simulation_protections"),
            ):
                with pytest.raises(Exception, match=error):
                    async with conn.begin_nested():
                        await conn.execute(text(statement + """
                            WHERE environment=:environment AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id AND protection_order_id=:protection
                        """), {**params, "source": source,
                               "protection": before[0]["protection_order_id"]})
            with pytest.raises(Exception,
                               match="confirmed protection lacks matching accepted fact"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        UPDATE simulation_protections SET status='confirmed',
                          confirmed_event_hash=:source
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id
                          AND run_id=:run_id AND protection_order_id=:protection
                    """), {**params, "source": source,
                           "protection": before[0]["protection_order_id"]})
            after = (await conn.execute(text("""
                SELECT protection_order_id,originating_event_hash,status,intended_json
                FROM simulation_protections
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().all()
            assert after == before
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_materialized_unfolded_fill_cannot_originate_obligation():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad)
        async with narrow.begin() as conn:
            events = await materialize_run_events(conn, run)
            fill = next(event for event in events if event.kind == "fill")
            params = {**run.scope.model_dump(), "run_id": run.run_id,
                      "order": order_id}
            order = (await conn.execute(text("""
                SELECT instrument_version_id,permit_json->>'location_id' location_id
                FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order
            """), params)).mappings().one()
            row = _row(run, order_id, order["instrument_version_id"],
                       order["location_id"], fill.event_hash)
            with pytest.raises(Exception,
                               match="violates foreign key constraint"):
                async with conn.begin_nested():
                    await conn.execute(INSERT, row)
                    await conn.execute(text(
                        "SET CONSTRAINTS simulation_protection_origin_check IMMEDIATE"))
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_protections
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            assert count == 0
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_protection_noop_receipt_stays_noop_then_two_due_commands_stop_once():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad, advance_to_end=False)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id=f"source-{uuid4()}")
        await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"fold-{uuid4()}")
        await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"checkpoint-{uuid4()}")
        before = PhaseCommand(run.scope, run.run_id, run.manifest_hash,
            f"before-{uuid4()}", "protection", {})
        quiet = await repo.process_protection_deadlines(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", phase_command=before)
        assert quiet["escalatedCount"] == 0 and quiet["stoppedEntries"] is False
        next_step = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"deadline-{uuid4()}")
        assert next_step["advanced"]
        assert await repo.process_protection_deadlines(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", phase_command=before) == quiet
        due = [PhaseCommand(run.scope, run.run_id, run.manifest_hash,
            f"due-{uuid4()}", "protection", {}) for _ in range(2)]
        outcomes = await asyncio.gather(*(repo.process_protection_deadlines(
            run.scope, run.run_id, run.manifest_hash, worker_id="stage2-verifier",
            phase_command=item) for item in due))
        assert sorted(item["escalatedCount"] for item in outcomes) == [0, 1]
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            state = (await conn.execute(text("""
                SELECT r.entries_stopped,r.status,p.status AS protection_status,p.reason
                FROM simulation_runs r JOIN simulation_protections p
                  USING(environment,scope_id,strategy_account_id,run_id)
                WHERE r.environment=:environment AND r.scope_id=:scope_id
                  AND r.strategy_account_id=:strategy_account_id AND r.run_id=:run_id
            """), params)).mappings().one()
        assert state["entries_stopped"] and state["status"] == "stopped_with_exposure"
        assert state["protection_status"] == "intended" and state["reason"] == DEADLINE_REASON
    finally:
        await narrow.dispose()
        await broad.dispose()
