"""Malformed later book in immutable SQL corpus must fail before causal orders."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import CAUSAL_MODEL_HASH
from moeazi_agent.lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from moeazi_agent.observation_contracts import BookLevel, MarketObservation, canonical_hash
from test_stage3_causal_envelope_product import _policy
from test_stage3_postgres_dataset import guarded_dsn, setup
from test_stage3_run_contracts import manifest, scenario
from test_stage3_lifecycle_contracts import H


@pytest.mark.asyncio
async def test_future_crossed_book_fails_causal_dataset_registration():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, original, rows = await setup(engine)
        later = rows[1]
        crossed = MarketObservation.model_validate(later.model_dump(mode="python") | {
            "source_event_id": f"crossed-future-{uuid4()}",
            "bids": (BookLevel(price_quote_per_base="30000", size_base="0.01"),),
            "asks": (BookLevel(price_quote_per_base="25001", size_base="0.02"),)})
        bad_hash = canonical_hash(crossed.model_dump(mode="json"))
        async with engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_market_events (
                  observation_hash,instrument_version_id,source_id,source_event_id,
                  source_kind,source_rights_ref,raw_payload_hash,raw_payload_ref,
                  observation_kind,event_at,available_at,received_at,sequence,
                  continuity,block_number,block_hash,finality,normalized_body)
                SELECT :hash,instrument_version_id,source_id,:event,source_kind,
                  source_rights_ref,raw_payload_hash,:rawref,observation_kind,
                  :eventat,:available,:received,sequence,continuity,block_number,
                  block_hash,finality,CAST(:body AS jsonb)
                FROM observation_market_events WHERE observation_hash=:oldhash
            """), {"hash": bad_hash,
                "oldhash": canonical_hash(later.model_dump(mode="json")),
                "event": crossed.source_event_id,
                "rawref": f"local:causal-corrupt:{uuid4()}",
                "eventat": crossed.event_at,
                "available": crossed.available_at,
                "received": crossed.received_at,
                "body": json.dumps(crossed.model_dump(mode="json"))})
        dataset = (rows[0], crossed)
        frozen = scenario(model_version=CAUSAL_MODEL_VERSION,
            model_hash=CAUSAL_MODEL_HASH,
            dataset_hash=simulation_dataset_hash(dataset),
            simulation_cursor_at=original.scenario.simulation_cursor_at,
            simulation_end_at=original.scenario.simulation_end_at,
            evidence_cutoff_at=original.scenario.evidence_cutoff_at,
            fee_rules=(), funding_rules=(), outcome_rules=(),
            max_execution_deviation_bps=500, order_time_in_force_ms=500,
            max_fill_events_per_order=4)
        run = manifest(scope=original.scope,
            controller_ref=original.controller_ref,
            run_id=f"causal-invalid-{uuid4()}",
            policy_version=original.policy_version,
            policy_hash=original.policy_hash,
            account_snapshot_hash=original.account_snapshot_hash,
            evidence_snapshot_hash=original.evidence_snapshot_hash,
            instrument_version_ids=original.instrument_version_ids,
            scenario=frozen, protection_policy=_policy())
        async with engine.connect() as conn:
            revision = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).scalar_one()
        await repo.register_run(run, created_by_subject="dataset-owner",
            experiment_request_hash=H, authority_fingerprint=H,
            expected_revision=revision, idempotency_key=f"causal-invalid-{uuid4()}")
        hashes = tuple(canonical_hash(row.model_dump(mode="json")) for row in dataset)
        with pytest.raises(FinanceError, match="source-admitted|invalid visible book"):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "dataset-owner")
        async with engine.connect() as conn:
            params = {**run.scope.model_dump(), "run_id": run.run_id}
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_run_datasets
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            orders = (await conn.execute(text("""
                SELECT count(*) FROM simulation_orders
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert count == orders == 0
    finally:
        await engine.dispose()
