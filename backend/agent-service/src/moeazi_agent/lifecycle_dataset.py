"""Immutable ordered market corpus for one experimental simulation run."""
from __future__ import annotations

import json
from collections import defaultdict

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .lifecycle_run_store import _run_params
from .observation_contracts import (
    EvidenceSnapshot, InstrumentVersion, MarketObservation, canonical_hash,
)
from .observation_replay import replay_observations
from .observation_storage import Q2_ADMISSION_POLICIES

MAX_OBSERVATIONS = 4096
NATIVE_RIGHTS = "internal_qualification_only"
FIXTURE_RIGHTS = "local_simulation_fixture_only"
SOURCE_ADMISSION_POLICY = "q2_internal_research_v1"
SOURCE_MAX_AGE_MS = Q2_ADMISSION_POLICIES[SOURCE_ADMISSION_POLICY]["max_age_ms"]


async def _run_binding(conn, manifest: SimulationRunManifest, *,
                       read_only: bool = False) -> dict:
    lock = "" if read_only else " FOR SHARE"
    row = (await conn.execute(text("""
        SELECT manifest_hash,manifest_json,status,cursor_sequence,entries_stopped,
               pending_obligations FROM simulation_runs
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """ + lock), _run_params(manifest.scope, manifest.run_id))).mappings().first()
    if row is None or row["manifest_hash"] != manifest.manifest_hash or \
            SimulationRunManifest.model_validate_json(json.dumps(row["manifest_json"])) != \
            manifest:
        raise FinanceError("simulation dataset does not match registered run")
    return dict(row)


async def _source_rows(conn, manifest: SimulationRunManifest,
                       observations: tuple[MarketObservation, ...]) -> None:
    if type(observations) is not tuple or not 1 <= len(observations) <= MAX_OBSERVATIONS or \
            simulation_dataset_hash(observations) != manifest.scenario.dataset_hash:
        raise FinanceError("ordered simulation corpus differs from frozen scenario")
    instrument_rows = (await conn.execute(text("""
        SELECT instrument_version_id,registry_hash,manifest
        FROM observation_instrument_versions
        WHERE instrument_version_id = ANY(CAST(:ids AS text[]))
    """), {"ids": list(manifest.instrument_version_ids)})).mappings().all()
    instrument_by_id = {row["instrument_version_id"]: row for row in instrument_rows}
    registry: dict[str, InstrumentVersion] = {}
    for version_id in manifest.instrument_version_ids:
        row = instrument_by_id.get(version_id)
        if row is None:
            raise FinanceError("simulation instrument version is unregistered")
        instrument = InstrumentVersion.model_validate(row["manifest"])
        if instrument.instrument_version_id != version_id or \
                instrument.registry_hash != row["registry_hash"]:
            raise FinanceError("simulation instrument registry hash differs")
        registry[version_id] = instrument
    expected_hashes = tuple(canonical_hash(item.model_dump(mode="json"))
                            for item in observations)
    source_rows = (await conn.execute(text("""
        SELECT observation_hash,normalized_body,source_kind,source_rights_ref,
               instrument_version_id,source_id,source_event_id,raw_payload_hash
        FROM observation_market_events
        WHERE observation_hash = ANY(CAST(:hashes AS text[]))
    """), {"hashes": list(expected_hashes)})).mappings().all()
    source_by_hash = {row["observation_hash"]: row for row in source_rows}
    sequence_groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for observation, expected_hash in zip(observations, expected_hashes):
        instrument = registry.get(observation.instrument_version_id)
        if instrument is None or instrument.venue_id != observation.source_id:
            raise FinanceError("simulation corpus crosses its registered instrument")
        row = source_by_hash.get(expected_hash)
        if row is None or row["observation_hash"] != expected_hash or \
                row["normalized_body"] != observation.model_dump(mode="json") or \
                row["source_kind"] != observation.source_kind or \
                row["source_rights_ref"] != observation.source_rights_ref or \
                row["instrument_version_id"] != observation.instrument_version_id or \
                row["source_id"] != observation.source_id or \
                row["source_event_id"] != observation.source_event_id or \
                row["raw_payload_hash"] != observation.raw_payload_hash:
            raise FinanceError("simulation observation differs from immutable source row")
        if observation.source_kind == "recorded_native":
            if observation.source_rights_ref != NATIVE_RIGHTS:
                raise FinanceError("recorded source lacks internal qualification rights")
        elif observation.source_kind == "synthetic_fault":
            if observation.source_rights_ref != FIXTURE_RIGHTS or \
                    manifest.scenario.clock_mode != "historical_replay":
                raise FinanceError("synthetic fixture cannot claim native or forward scope")
        else:
            raise FinanceError("SQL simulation corpus has unsupported source kind")
        if instrument.effective_at > observation.event_at or \
                observation.event_at > observation.available_at or \
                observation.available_at > observation.received_at or \
                observation.received_at > manifest.scenario.simulation_end_at:
            raise FinanceError("simulation observation has invalid replay time")
        admitted = replay_observations((instrument,), (observation,),
                                       observation.received_at, SOURCE_MAX_AGE_MS)
        if admitted.accepted_observation_hashes != (expected_hash,):
            raise FinanceError("simulation observation is not source-admitted")
        if observation.continuity == "sequenced":
            sequence_groups[(observation.source_id,
                             observation.instrument_version_id)].append(
                                 observation.sequence or 0)
    for positions in sequence_groups.values():
        ordered = sorted(positions)
        if any(right != left + 1 for left, right in zip(ordered, ordered[1:])):
            raise FinanceError("simulation corpus has sequence gap or collision")
    if manifest.scenario.model_version == CAUSAL_MODEL_VERSION:
        from .lifecycle_simulator_causal_inputs import validate_causal_corpus

        validate_causal_corpus(manifest, registry, observations)
    evidence_row = (await conn.execute(text("""
        SELECT cutoff_at,instrument_version_ids,accepted_observation_hashes,
               excluded,source_rights_refs,has_gap
        FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
    """), {"hash": manifest.evidence_snapshot_hash})).mappings().first()
    if evidence_row is None:
        raise FinanceError("simulation decision evidence is not stored")
    evidence = EvidenceSnapshot(schema_version=1,
        cutoff_at=evidence_row["cutoff_at"],
        instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
        excluded=tuple(evidence_row["excluded"]),
        source_rights_refs=tuple(evidence_row["source_rights_refs"]),
        has_gap=evidence_row["has_gap"], snapshot_hash=manifest.evidence_snapshot_hash)
    if evidence.has_gap or evidence.cutoff_at != manifest.scenario.evidence_cutoff_at or \
            canonical_hash(evidence.model_dump(mode="json", exclude={"snapshot_hash"})) \
            != evidence.snapshot_hash:
        raise FinanceError("simulation decision evidence is incomplete or changed")
    admitted = set(evidence.accepted_observation_hashes)
    for version_id in registry:
        earlier = [row for row in observations
                   if row.instrument_version_id == version_id and
                   row.available_at <= manifest.scenario.evidence_cutoff_at]
        latest = max(earlier, key=lambda row: (row.available_at, row.event_at,
                     row.source_event_id), default=None)
        if latest is None or (manifest.scenario.simulation_cursor_at -
                              latest.event_at).total_seconds() * 1000 > \
                manifest.scenario.max_book_age_ms or \
                canonical_hash(latest.model_dump(mode="json")) not in admitted:
            raise FinanceError("simulation instrument lacks fresh decision-time book")


async def register_dataset(conn, manifest: SimulationRunManifest,
                           observations: tuple[MarketObservation, ...]) -> None:
    """Register once inside caller's scoped transaction; retries compare exact rows."""
    run = await _run_binding(conn, manifest)
    await _source_rows(conn, manifest, observations)
    params = _run_params(manifest.scope, manifest.run_id)
    existing = (await conn.execute(text("""
        SELECT dataset_hash,observation_count FROM simulation_run_datasets
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().first()
    if existing:
        if existing["dataset_hash"] != manifest.scenario.dataset_hash or \
                existing["observation_count"] != len(observations) or \
                await load_dataset(conn, manifest) != observations:
            raise FinanceError("registered simulation dataset identity conflicts")
        return
    if run["entries_stopped"] or run["status"] != "registered" or \
            run["cursor_sequence"] != 0 or run["pending_obligations"]:
        raise FinanceError("active or stopped run cannot register a new dataset")
    await conn.execute(text("""
        INSERT INTO simulation_run_datasets(environment,scope_id,strategy_account_id,
          run_id,dataset_hash,observation_count)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:hash,:count)
    """), {**params, "hash": manifest.scenario.dataset_hash,
           "count": len(observations)})
    await conn.execute(text("""
        INSERT INTO simulation_run_dataset_items(environment,scope_id,
          strategy_account_id,run_id,dataset_hash,observation_ordinal,
          observation_hash)
        SELECT :environment,:scope_id,:strategy_account_id,:run_id,:hash,
          item.ordinal,item.observation
        FROM UNNEST(CAST(:ordinals AS integer[]),CAST(:observations AS text[]))
          AS item(ordinal,observation)
    """), {**params, "hash": manifest.scenario.dataset_hash,
           "ordinals": list(range(len(observations))),
           "observations": [canonical_hash(item.model_dump(mode="json"))
                            for item in observations]})


async def load_dataset(conn, manifest: SimulationRunManifest, *,
                       read_only: bool = False) -> tuple[MarketObservation, ...]:
    """Resolve exact source rows; an absent/incomplete corpus cannot dispatch."""
    await _run_binding(conn, manifest, read_only=read_only)
    params = _run_params(manifest.scope, manifest.run_id)
    header = (await conn.execute(text("""
        SELECT dataset_hash,observation_count FROM simulation_run_datasets
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)).mappings().first()
    if not header or header["dataset_hash"] != manifest.scenario.dataset_hash or \
            not 1 <= header["observation_count"] <= MAX_OBSERVATIONS:
        raise FinanceError("simulation run has no complete frozen dataset")
    rows = (await conn.execute(text("""
        SELECT item.observation_ordinal,item.observation_hash,
               source.normalized_body FROM simulation_run_dataset_items item
        JOIN observation_market_events source
          ON source.observation_hash=item.observation_hash
        WHERE item.environment=:environment AND item.scope_id=:scope_id
          AND item.strategy_account_id=:strategy_account_id AND item.run_id=:run_id
          AND item.dataset_hash=:hash ORDER BY item.observation_ordinal
    """), {**params, "hash": manifest.scenario.dataset_hash})).mappings().all()
    if len(rows) != header["observation_count"] or \
            any(row["observation_ordinal"] != index for index, row in enumerate(rows)):
        raise FinanceError("simulation corpus has missing or reordered source rows")
    observations = tuple(MarketObservation.model_validate(row["normalized_body"])
                         for row in rows)
    if any(canonical_hash(row.model_dump(mode="json")) != source["observation_hash"]
           for row, source in zip(observations, rows)) or \
            simulation_dataset_hash(observations) != manifest.scenario.dataset_hash:
        raise FinanceError("simulation corpus hash differs from stored source")
    await _source_rows(conn, manifest, observations)
    return observations
