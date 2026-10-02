"""Exact preparation and human approval lineage on the disposable Q4 database."""
from datetime import timedelta
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_contracts import ProtectionRequirement, TradeIntent
from moeazi_agent.lifecycle_dataset import register_dataset
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION, simulate_order
from moeazi_agent.lifecycle_state import EntryAuthorityReceipt
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.observation_contracts import MarketObservation
from test_stage2_finance_postgres_reservations import request, reserve_command
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_lifecycle_contracts import seal
from test_stage3_run_contracts import manifest, scenario


def guarded_dsn():
    import os
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"):
        raise RuntimeError("Q4 preparation test is restricted to root's disposable DB")
    return raw


async def setup(engine):
    identity = uuid4().hex
    finance, scope, epoch, instrument, snapshot, evidence, policy, opened = \
        await setup_spot_account(engine, identity, quote_units="1000000000",
                                 max_gross="1000000000", max_quantity="10000000")
    async with engine.connect() as conn:
        body = (await conn.execute(text("""
            SELECT normalized_body FROM observation_market_events
            WHERE observation_hash=:hash
        """), {"hash": evidence.accepted_observation_hashes[0]})).scalar_one()
    book = MarketObservation.model_validate(body)
    cursor = max(book.available_at, evidence.cutoff_at) + timedelta(milliseconds=1)
    frozen = scenario(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
        simulation_cursor_at=cursor,
        simulation_end_at=cursor + timedelta(minutes=2),
        evidence_cutoff_at=evidence.cutoff_at, max_book_age_ms=60_000,
        dataset_hash=simulation_dataset_hash((book,)), fee_bps=0,
        fee_rules=(), funding_rules=(), outcome_rules=())
    controller = ControllerRef(schemaVersion=1, environment="experiment",
        strategyAccountId=scope.strategy_account_id, controllerKind="customer_team",
        controllerId=scope.scope_id, controllerVersionId=f"{scope.scope_id}:v1",
        contentHash="a" * 64)
    run = manifest(scope=scope, controller_ref=controller,
        run_id=f"run-{identity}", policy_version=policy.policy_version,
        policy_hash=policy.policy_hash,
        instrument_version_ids=(instrument.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash, scenario=frozen,
        controller_mode="approval_required")

    async def authorize(req):
        async with engine.connect() as conn:
            checked = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
        return EntryAuthorityReceipt(schema_version=1, scope=req.scope,
            run_id=req.run_id, controller_ref=req.controller_ref,
            controller_mode=req.controller_mode,
            created_by_subject=req.created_by_subject,
            experiment_request_hash=req.experiment_request_hash,
            authority_fingerprint=req.registered_authority_fingerprint,
            checked_at=checked)

    repo = SimulationLifecycleRepository(finance, simulator=simulate_order,
                                         entry_authorizer=authorize)
    await repo.register_run(run, created_by_subject="verified-owner",
        experiment_request_hash="b" * 64, authority_fingerprint="a" * 64,
        expected_revision=opened["revision"], idempotency_key="prep-register-01")
    async with engine.begin() as conn:
        await register_dataset(conn, run, (book,))
    sizing = await finance.prepare_experiment_sizing_receipt(scope, epoch,
        opened["revision"], policy.policy_version,
        request(instrument, snapshot, evidence, 1_000_000, 0))
    command = await reserve_command(engine, scope, epoch, opened, policy, snapshot,
        sizing, purpose="trade", team=scope.scope_id,
        intent=f"intent-{identity}", revision=opened["revision"])
    command = command.model_copy(update={"controller_mode": "approval_required"})
    from moeazi_agent.finance_contracts import ReserveCommand, semantic_request_hash
    command = ReserveCommand.model_validate(command.model_dump() | {
        "request_hash": semantic_request_hash("reserve", command)})
    reserved = await finance.reserve_intent(command)
    protection = ProtectionRequirement(required=False,
        policy_version=policy.policy_version, policy_hash=policy.policy_hash,
        maximum_unprotected_seconds=0, on_rejection="hold_and_escalate")
    intent = seal(TradeIntent, "moeazi-trade-intent-v1", "intent_hash", dict(
        schema_version=1, scope=scope, controller_ref=controller,
        controller_mode="approval_required", run_id=run.run_id,
        run_manifest_hash=run.manifest_hash, intent_id=command.intent_id,
        strategy_artifact_hash=run.strategy_artifact_hash,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash,
        action="spot_buy", side="buy", target_exposure_units="1000000",
        desired_quantity_units="1000000", horizon_seconds=60,
        evidence_snapshot_hash=evidence.snapshot_hash,
        calculation_receipt_hash=sizing["receipt_hash"], supplied_claim_ids=(),
        verified_claim_receipt_hashes=(), rationale_summary="Recorded test book",
        invalidation_rule_hash="c" * 64,
        expires_at_cursor=cursor + timedelta(minutes=1), protection=protection))
    return repo, finance, run, intent, reserved


@pytest.mark.asyncio
async def test_approval_requires_prepared_payload_and_is_revocable():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, finance, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        from datetime import datetime, timezone
        expires = datetime.now(timezone.utc) + timedelta(seconds=30)
        with pytest.raises(FinanceError, match="not prepared"):
            await repo.record_simulation_approval(run.scope, run.run_id,
                run.manifest_hash, intent.intent_id, "d" * 64,
                "verified-owner", expires, "approve-fake")
        fresh = repo.entry_authorizer

        async def delayed(request):
            receipt = await fresh(request)
            return receipt.model_copy(update={
                "checked_at": receipt.checked_at - timedelta(seconds=6)})

        repo.entry_authorizer = delayed
        with pytest.raises(FinanceError, match="delayed"):
            await repo.prepare_order(intent, reserved["reservationId"], 1,
                worker_id="stage2-verifier", command_id="prepare-stale")
        repo.entry_authorizer = fresh
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-1")
        duplicate = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-1")
        assert prepared["status"] == "prepared"
        assert duplicate["normalizedPayloadHash"] == prepared["normalizedPayloadHash"]
        approval = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", expires, "approve-1")
        assert len(approval["approvalReceiptHash"]) == 64
        assert (await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", expires, "approve-1"))["status"] == "duplicate"
        newer = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", expires, "approve-2")
        assert (await repo.revoke_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, newer["approvalReceiptHash"],
            "verified-owner"))["status"] == "revoked"
        with pytest.raises(FinanceError, match="expired or differs"):
            await repo.start_order(run.scope, run.run_id, prepared["orderId"],
                worker_id="stage2-verifier",
                approval_receipt_hash=approval["approvalReceiptHash"])
        with pytest.raises(FinanceError, match="expired or differs"):
            await repo.start_order(run.scope, run.run_id, prepared["orderId"],
                worker_id="stage2-verifier",
                approval_receipt_hash=newer["approvalReceiptHash"])
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_order_and_financial_possible_attempt_commit_together():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-start")
        from datetime import datetime, timezone
        approval = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=30),
            "approve-start")
        started = await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=approval["approvalReceiptHash"])
        duplicate = await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="replacement-worker",
            approval_receipt_hash=approval["approvalReceiptHash"])
        assert started["status"] == "submission_possible"
        assert duplicate["status"] == "duplicate"
        assert duplicate["permit"] == started["permit"]
        async with engine.connect() as conn:
            rows = (await conn.execute(text("""
                SELECT o.status order_status,a.status attempt_status,r.status reserve_status
                FROM simulation_orders o JOIN finance_submission_attempts a
                  ON a.environment=o.environment AND a.scope_id=o.scope_id
                  AND a.strategy_account_id=o.strategy_account_id
                  AND a.attempt_id=o.attempt_id
                JOIN finance_reservations r
                  ON r.environment=o.environment AND r.scope_id=o.scope_id
                  AND r.strategy_account_id=o.strategy_account_id
                  AND r.reservation_id=o.reservation_id
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                  AND o.order_id=:order_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                   "order_id": prepared["orderId"]})).mappings().all()
        assert len(rows) == 1
        assert tuple(rows[0].values()) == (
            "submission_possible", "possible", "submitted")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_entry_request_rejects_missing_frozen_dataset():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, baseline, _, _ = await setup(engine)
        rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1",
            "rule_hash", dict(schema_version=1,
            instrument_version_id=baseline.instrument_version_ids[0],
            action="spot_buy", side="buy", trigger="always",
            threshold_price_quote_per_base=None,
            desired_quantity_units="1000000", horizon_seconds=60,
            rationale_summary="Frozen decision book"))
        pending = manifest(scope=baseline.scope,
            controller_ref=baseline.controller_ref,
            controller_mode=baseline.controller_mode,
            run_id=f"missing-dataset-{uuid4().hex}",
            strategy_artifact_hash=rule.rule_hash,
            policy_version=baseline.policy_version,
            policy_hash=baseline.policy_hash,
            instrument_version_ids=baseline.instrument_version_ids,
            evidence_snapshot_hash=baseline.evidence_snapshot_hash,
            account_snapshot_hash=baseline.account_snapshot_hash,
            scenario=baseline.scenario)
        async with engine.connect() as conn:
            revision = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), pending.scope.model_dump())).scalar_one()
        await repo.register_run(pending, created_by_subject="verified-owner",
            experiment_request_hash="b" * 64, authority_fingerprint="a" * 64,
            expected_revision=revision, idempotency_key=f"register-{pending.run_id}")
        with pytest.raises(FinanceError, match="dataset|corpus"):
            await repo.queue_entry_request(pending.scope, pending.run_id,
                pending.manifest_hash, rule, "verified-owner", "no-dataset-1")
        assert (await repo.read_run(pending.scope, pending.run_id,
            pending.manifest_hash)).status == "registered"
    finally:
        await engine.dispose()
