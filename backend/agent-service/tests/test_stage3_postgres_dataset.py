"""Actual SQL062 ordered corpus checks on root's disposable Q4 database."""
import hashlib
import json
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION, simulate_order
from moeazi_agent.observation_contracts import MarketObservation, canonical_hash
from moeazi_agent.observation_storage import ObservationRepository
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_lifecycle_contracts import H
from test_stage3_run_contracts import manifest, scenario


def guarded_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"):
        raise RuntimeError("Stage3 dataset tests cannot target an application DB")
    return raw


async def setup(engine, *, bad_rights=False, unadmitted_before_cutoff=False):
    identity = uuid4().hex
    finance, scope, _, instrument, snapshot, evidence, policy, opened = (
        await setup_spot_account(engine, identity))
    async with engine.connect() as conn:
        row = (await conn.execute(text("""
            SELECT normalized_body FROM observation_market_events
            WHERE observation_hash=:hash
        """), {"hash": evidence.accepted_observation_hashes[0]})).mappings().one()
    first = MarketObservation.model_validate(row["normalized_body"])
    second_bytes = f"local-q4-corpus:{identity}".encode()
    second = MarketObservation.model_validate({
        **first.model_dump(mode="python"),
        "source_event_id": f"synthetic-next-{identity}",
        "source_kind": "recorded_native" if bad_rights else "synthetic_fault",
        "source_rights_ref": ("wrong-native-rights" if bad_rights
                              else "local_simulation_fixture_only"),
        "raw_payload_hash": hashlib.sha256(second_bytes).hexdigest(),
        "event_at": evidence.cutoff_at + timedelta(milliseconds=
            -100 if unadmitted_before_cutoff else 100),
        "available_at": evidence.cutoff_at + timedelta(milliseconds=
            0 if unadmitted_before_cutoff else 200),
        "received_at": evidence.cutoff_at + timedelta(milliseconds=
            0 if unadmitted_before_cutoff else 200),
    })
    if not bad_rights:
        await ObservationRepository(engine).ingest_market_observation(
            instrument, second, raw_payload_bytes=second_bytes,
            raw_payload_ref=f"local:stage3:{identity}",
            policy_version="q2_internal_research_v1")
    controller = ControllerRef(schemaVersion=1, environment="experiment",
        strategyAccountId=scope.strategy_account_id, controllerKind="customer_team",
        controllerId=scope.scope_id, controllerVersionId="dataset-version",
        contentHash=H)
    rows = (first, second)
    frozen = scenario(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
        dataset_hash=simulation_dataset_hash(rows),
        evidence_cutoff_at=evidence.cutoff_at,
        simulation_cursor_at=evidence.cutoff_at,
        simulation_end_at=evidence.cutoff_at + timedelta(seconds=2),
        fee_rules=(), funding_rules=(), outcome_rules=())
    run = manifest(scope=scope, controller_ref=controller,
        run_id=f"dataset-{identity}", policy_version=policy.policy_version,
        policy_hash=policy.policy_hash, account_snapshot_hash=snapshot.snapshot_hash,
        evidence_snapshot_hash=evidence.snapshot_hash,
        instrument_version_ids=(instrument.instrument_version_id,), scenario=frozen)
    repo = SimulationLifecycleRepository(finance, simulator=simulate_order)
    await repo.register_run(run, created_by_subject="dataset-owner",
        experiment_request_hash=H, authority_fingerprint=H,
        expected_revision=opened["revision"],
        idempotency_key=f"dataset-register-{identity}")
    return repo, run, rows


@pytest.mark.asyncio
async def test_ordered_corpus_hash_only_registration_duplicate_and_immutable_rows():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, rows = await setup(engine)
        hashes = tuple(canonical_hash(item.model_dump(mode="json")) for item in rows)
        first = await repo.register_run_dataset(run.scope, run.run_id,
            run.manifest_hash, hashes, "dataset-owner")
        duplicate = await repo.register_run_dataset(run.scope, run.run_id,
            run.manifest_hash, hashes, "dataset-owner")
        assert first == {"datasetHash": run.scenario.dataset_hash,
                         "observationCount": 2, "status": "registered"}
        assert duplicate["status"] == "duplicate"
        async with engine.connect() as conn:
            persisted = (await conn.execute(text("""
                SELECT observation_ordinal,observation_hash
                FROM simulation_run_dataset_items
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                ORDER BY observation_ordinal
            """), {**run.scope.model_dump(), "run_id": run.run_id})).all()
            assert persisted == [(0, hashes[0]), (1, hashes[1])]
            from moeazi_agent.lifecycle_dataset import load_dataset
            assert await load_dataset(conn, run) == rows
        assert rows[1].available_at > run.scenario.evidence_cutoff_at
        assert rows[1].available_at < run.scenario.simulation_end_at
        with pytest.raises(FinanceError):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, tuple(reversed(hashes)), "dataset-owner")
        with pytest.raises(FinanceError):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, (hashes[0], "b" * 64), "dataset-owner")
        with pytest.raises(FinanceError):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "foreign-owner")
        with pytest.raises(FinanceError):
            await repo.register_run_dataset(FinanceScope(environment="live",
                scope_id="live", strategy_account_id=run.scope.strategy_account_id),
                run.run_id, run.manifest_hash, hashes, "dataset-owner")
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                with pytest.raises(DBAPIError):
                    await conn.execute(text("""
                        UPDATE simulation_run_dataset_items
                        SET observation_hash=:hash WHERE environment='experiment'
                          AND scope_id=:scope AND run_id=:run
                    """), {"hash": hashes[1], "scope": run.scope.scope_id,
                           "run": run.run_id})
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_unstored_or_rights_spoofed_future_book_cannot_register():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, rows = await setup(engine, bad_rights=True)
        hashes = tuple(canonical_hash(item.model_dump(mode="json")) for item in rows)
        with pytest.raises(FinanceError, match="missing source"):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "dataset-owner")
        # Simulate a compromised source-row writer. A matching hash and complete
        # normalized body must still not promote unlicensed native data.
        async with engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_market_events (
                    observation_hash,instrument_version_id,source_id,source_event_id,
                    source_kind,source_rights_ref,raw_payload_hash,raw_payload_ref,
                    observation_kind,event_at,available_at,received_at,sequence,
                    continuity,block_number,block_hash,finality,normalized_body)
                SELECT :hash,instrument_version_id,source_id,:event,:kind,:rights,
                    :rawhash,:rawref,observation_kind,:eventat,:available,:received,
                    sequence,continuity,block_number,block_hash,finality,
                    CAST(:body AS jsonb)
                FROM observation_market_events WHERE observation_hash=:firsthash
            """), {"hash": hashes[1], "firsthash": hashes[0],
                "event": rows[1].source_event_id,
                "kind": rows[1].source_kind,
                "rights": rows[1].source_rights_ref,
                "rawhash": rows[1].raw_payload_hash,
                "rawref": f"local:corrupt-source:{run.run_id}",
                "eventat": rows[1].event_at,
                "available": rows[1].available_at,
                "received": rows[1].received_at,
                "body": json.dumps(rows[1].model_dump(mode="json"))})
        with pytest.raises(FinanceError, match="internal qualification rights"):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "dataset-owner")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_committed_incomplete_corpus_cannot_load_or_be_silently_repaired():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, rows = await setup(engine)
        hashes = tuple(canonical_hash(item.model_dump(mode="json")) for item in rows)
        # Represent a crash or direct SQL writer that committed a header without
        # its ordered item rows. Loader and later registration must fail closed.
        async with engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO simulation_run_datasets(environment,scope_id,
                    strategy_account_id,run_id,dataset_hash,observation_count)
                VALUES (:environment,:scope_id,:strategy_account_id,:run_id,:hash,2)
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                "hash": run.scenario.dataset_hash})
        from moeazi_agent.lifecycle_dataset import load_dataset
        async with engine.connect() as conn:
            with pytest.raises(FinanceError, match="missing or reordered"):
                await load_dataset(conn, run)
        with pytest.raises(FinanceError, match="missing or reordered"):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "dataset-owner")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_selected_pre_cutoff_book_must_belong_to_accepted_evidence():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, rows = await setup(engine, unadmitted_before_cutoff=True)
        hashes = tuple(canonical_hash(item.model_dump(mode="json")) for item in rows)
        assert rows[1].available_at == run.scenario.evidence_cutoff_at
        with pytest.raises(FinanceError, match="decision-time book"):
            await repo.register_run_dataset(run.scope, run.run_id,
                run.manifest_hash, hashes, "dataset-owner")
    finally:
        await engine.dispose()
