"""Server-only Q4 finance inputs from a frozen worker evaluation."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.lifecycle_replay_admission_inputs import load_replay_financial_inputs
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_replay_entry import LifecycleReplayEntryMixin
from moeazi_agent.lifecycle_state import EntryAuthorityReceipt
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_entry_processor_postgres import prepare, process
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_frozen_evaluation_resolves_only_stored_replay_financial_inputs():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, manifest, _, _ = await prepare(broad, narrow)
        outcome = await process(repo, manifest, "admission-input-tick")
        assert outcome["status"] == "awaiting_finance"
        params = {**manifest.scope.model_dump(), "run_id": manifest.run_id}
        async with narrow.connect() as conn:
            account = (await conn.execute(text("""
                SELECT * FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            run = (await conn.execute(text("""
                SELECT * FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)).mappings().one()
            request = (await conn.execute(text("""
                SELECT * FROM simulation_entry_requests WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND request_id='request-a'
            """), params)).mappings().one()
            loaded = await load_replay_financial_inputs(conn, manifest.scope,
                run, account, request)
        assert loaded["manifest"].manifest_hash == manifest.manifest_hash
        assert loaded["draft"].action == "spot_buy"
        assert loaded["decision"].account_snapshot_hash == account["observation_snapshot_hash"]
        assert loaded["pending_receipts"] == ()
        # This signal fixture has a zero fee ceiling while its scenario charges
        # a quote fee, so financial admission must reject it after source loading.
        with pytest.raises(ValueError, match="quote fee ceiling"):
            build_replay_sizing_receipt(loaded["manifest"], loaded["decision"],
                loaded["policy"], loaded["instrument"], loaded["book"],
                loaded["evidence"], loaded["dataset"], loaded["snapshot"],
                loaded["positions"], loaded["pending_receipts"],
                request_id=request["request_id"], action=loaded["draft"].action,
                side=loaded["draft"].side,
                desired_quantity_units=loaded["draft"].desired_quantity_units,
                order_ordinal=request["request_sequence"],
                account_revision=account["revision"])
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_unfunded_replay_fee_policy_rejects_without_reservation():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, manifest, _, revision = await prepare(broad, narrow)
        await process(repo, manifest, "unfunded-evaluation")

        async def authorizer(request):
            async with narrow.connect() as conn:
                now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
            return EntryAuthorityReceipt(schema_version=1, scope=request.scope,
                run_id=request.run_id, controller_ref=request.controller_ref,
                controller_mode=request.controller_mode,
                created_by_subject=request.created_by_subject,
                experiment_request_hash=request.experiment_request_hash,
                authority_fingerprint=request.registered_authority_fingerprint,
                checked_at=now)

        repo.entry_authorizer = authorizer
        denied = await LifecycleReplayEntryMixin.prepare_replay_entry(repo,
            manifest.scope, manifest.run_id, manifest.manifest_hash,
            "request-a", "stage2-verifier", "unfunded-admission")
        assert denied == {"requestId": "request-a", "status": "rejected",
                          "reason": "replay_policy_or_valuation_denied"}
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT revision,(SELECT count(*) FROM finance_reservations r
                  WHERE r.environment=a.environment AND r.scope_id=a.scope_id
                    AND r.strategy_account_id=a.strategy_account_id) holds
                FROM finance_accounts a WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), manifest.scope.model_dump())).one()
        assert tuple(row) == (revision, 0)
    finally:
        await narrow.dispose()
        await broad.dispose()
