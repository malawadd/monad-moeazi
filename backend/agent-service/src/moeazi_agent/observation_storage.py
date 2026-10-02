"""Insert-only observation registry and replay receipts in Timescale/PostgreSQL."""
from __future__ import annotations

import hashlib
import json
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .observation_contracts import InstrumentVersion, MarketObservation, EvidenceSnapshot, canonical_hash
from .observation_replay import replay_observations
from .native_observations import hyperliquid_book_observation


class ObservationConflict(ValueError):
    pass


Q2_ADMISSION_POLICIES = {"q2_internal_research_v1": {"max_age_ms": 60_000}}


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class ObservationRepository:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def register_instrument(self, instrument: InstrumentVersion) -> InstrumentVersion:
        manifest = instrument.model_dump(mode="json")
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_instrument_versions
                  (instrument_version_id,venue_id,native_instrument_id,product_kind,
                   registry_hash,manifest,effective_at)
                VALUES (:id,:venue,:native,:kind,:hash,CAST(:manifest AS jsonb),:effective)
                ON CONFLICT DO NOTHING
            """), {"id": instrument.instrument_version_id, "venue": instrument.venue_id,
                   "native": instrument.native_instrument_id, "kind": instrument.product_kind,
                   "hash": instrument.registry_hash, "manifest": _json(manifest),
                   "effective": instrument.effective_at})
            stored = (await conn.execute(text("""
                SELECT manifest FROM observation_instrument_versions WHERE instrument_version_id=:id
            """), {"id": instrument.instrument_version_id})).mappings().first()
            if not stored:
                raise ObservationConflict("Instrument version identity conflicts with stored manifest")
            canonical = InstrumentVersion.model_validate(stored["manifest"])
            if canonical.model_dump(exclude={"effective_at"}) != instrument.model_dump(exclude={"effective_at"}) \
                    or instrument.effective_at < canonical.effective_at:
                raise ObservationConflict("Instrument version identity conflicts with stored manifest")
        return canonical

    async def ingest_market_observation(
        self, instrument: InstrumentVersion, observation: MarketObservation,
        *, raw_payload_bytes: bytes, raw_payload_ref: str,
        policy_version: Literal["q2_internal_research_v1"],
    ) -> str:
        # Q2 research policy only. A later production policy needs a reviewed version.
        policy = Q2_ADMISSION_POLICIES.get(policy_version)
        if policy is None:
            raise ValueError("Unknown observation admission policy")
        if not raw_payload_ref or len(raw_payload_ref) > 1024:
            raise ValueError("Governed raw payload reference is required")
        if hashlib.sha256(raw_payload_bytes).hexdigest() != observation.raw_payload_hash:
            raise ObservationConflict("Raw response bytes do not match observation hash")
        if instrument.instrument_version_id != observation.instrument_version_id:
            raise ObservationConflict("Observation instrument version differs")
        if observation.source_kind == "recorded_native":
            if observation.source_id != "hyperliquid" or observation.observation_kind != "book_snapshot":
                raise ValueError("Recorded native source parser is unavailable")
            derived = hyperliquid_book_observation(raw_payload_bytes, instrument,
                received_at=observation.received_at,
                source_rights_ref=observation.source_rights_ref)
            if derived != observation:
                raise ObservationConflict("Normalized market observation differs from native response")
        elif observation.source_kind != "synthetic_fault":
            raise ValueError("Documentation examples cannot be ingested as observations")
        async with self.engine.connect() as conn:
            registered = (await conn.execute(text("""
                SELECT manifest FROM observation_instrument_versions WHERE instrument_version_id=:id
            """), {"id": instrument.instrument_version_id})).mappings().first()
        canonical = InstrumentVersion.model_validate(registered["manifest"]) if registered else None
        if not canonical or canonical.model_dump(exclude={"effective_at"}) != instrument.model_dump(exclude={"effective_at"}) \
                or instrument.effective_at < canonical.effective_at:
            raise ObservationConflict("Instrument registry version is unavailable")
        result = replay_observations([canonical], [observation], observation.received_at,
                                     policy["max_age_ms"])
        if not result.accepted_observation_hashes:
            raise ValueError(f"Observation is quarantined: {result.excluded[0].reason}")
        observation_hash = result.accepted_observation_hashes[0]
        normalized = observation.model_dump(mode="json")
        async with self.engine.begin() as conn:
            registry = (await conn.execute(text("""
                SELECT manifest FROM observation_instrument_versions WHERE instrument_version_id=:id
            """), {"id": instrument.instrument_version_id})).mappings().first()
            canonical = InstrumentVersion.model_validate(registry["manifest"]) if registry else None
            if not canonical or canonical.model_dump(exclude={"effective_at"}) != instrument.model_dump(exclude={"effective_at"}) \
                    or instrument.effective_at < canonical.effective_at:
                raise ObservationConflict("Instrument registry version is unavailable")
            await conn.execute(text("""
                INSERT INTO observation_market_events
                  (observation_hash,instrument_version_id,source_id,source_event_id,source_kind,
                   source_rights_ref,raw_payload_hash,raw_payload_ref,observation_kind,event_at,
                   available_at,received_at,sequence,continuity,block_number,block_hash,
                   finality,normalized_body)
                VALUES (:hash,:instrument,:source,:event,:kind,:rights,:rawhash,:rawref,:obskind,
                        :eventat,:available,:received,:sequence,:continuity,:blocknumber,
                        :blockhash,:finality,CAST(:body AS jsonb))
                ON CONFLICT DO NOTHING
            """), {"hash": observation_hash, "instrument": observation.instrument_version_id,
                   "source": observation.source_id, "event": observation.source_event_id,
                   "kind": observation.source_kind, "rights": observation.source_rights_ref,
                   "rawhash": observation.raw_payload_hash, "rawref": raw_payload_ref,
                   "obskind": observation.observation_kind, "eventat": observation.event_at,
                   "available": observation.available_at, "received": observation.received_at,
                   "sequence": observation.sequence, "continuity": observation.continuity,
                   "blocknumber": observation.block_number, "blockhash": observation.block_hash,
                   "finality": observation.finality, "body": _json(normalized)})
            stored = (await conn.execute(text("""
                SELECT observation_hash,normalized_body,raw_payload_ref FROM observation_market_events
                WHERE source_id=:source AND instrument_version_id=:instrument AND source_event_id=:event
            """), {"source": observation.source_id,
                   "instrument": observation.instrument_version_id,
                   "event": observation.source_event_id})).mappings().first()
            if not stored or stored["observation_hash"] != observation_hash \
                    or dict(stored["normalized_body"]) != normalized \
                    or stored["raw_payload_ref"] != raw_payload_ref:
                raise ObservationConflict("Source event identity conflicts with immutable observation")
        return observation_hash

    async def store_evidence_snapshot(self, snapshot: EvidenceSnapshot) -> str:
        body = snapshot.model_dump(mode="json", exclude={"snapshot_hash"})
        if canonical_hash(body) != snapshot.snapshot_hash:
            raise ObservationConflict("Evidence snapshot hash does not match its contents")
        async with self.engine.begin() as conn:
            admitted: list[MarketObservation] = []
            versions: dict[str, InstrumentVersion] = {}
            for observation_hash in snapshot.accepted_observation_hashes:
                row = (await conn.execute(text("""
                    SELECT normalized_body FROM observation_market_events WHERE observation_hash=:hash
                """), {"hash": observation_hash})).mappings().first()
                if not row:
                    raise ObservationConflict("Evidence snapshot references a missing observation")
                admitted.append(MarketObservation.model_validate(row["normalized_body"]))
            for instrument_id in {row.instrument_version_id for row in admitted}:
                row = (await conn.execute(text("""
                    SELECT manifest FROM observation_instrument_versions WHERE instrument_version_id=:id
                """), {"id": instrument_id})).mappings().first()
                if not row:
                    raise ObservationConflict("Evidence snapshot instrument version is missing")
                versions[instrument_id] = InstrumentVersion.model_validate(row["manifest"])
            admitted_replay = replay_observations(versions.values(), admitted,
                snapshot.cutoff_at, Q2_ADMISSION_POLICIES["q2_internal_research_v1"]["max_age_ms"])
            if admitted_replay.accepted_observation_hashes != snapshot.accepted_observation_hashes \
                    or admitted_replay.instrument_version_ids != snapshot.instrument_version_ids \
                    or admitted_replay.source_rights_refs != snapshot.source_rights_refs:
                raise ObservationConflict("Evidence snapshot includes inadmissible market observations")
            await conn.execute(text("""
                INSERT INTO observation_evidence_snapshots
                  (snapshot_hash,cutoff_at,instrument_version_ids,accepted_observation_hashes,
                   excluded,source_rights_refs,has_gap)
                VALUES (:hash,:cutoff,CAST(:instruments AS jsonb),CAST(:accepted AS jsonb),
                        CAST(:excluded AS jsonb),CAST(:rights AS jsonb),:gap) ON CONFLICT DO NOTHING
            """), {"hash": snapshot.snapshot_hash, "cutoff": snapshot.cutoff_at,
                   "instruments": _json(body["instrument_version_ids"]),
                   "accepted": _json(body["accepted_observation_hashes"]),
                   "excluded": _json(body["excluded"]),
                   "rights": _json(body["source_rights_refs"]), "gap": snapshot.has_gap})
            stored = (await conn.execute(text("""
                SELECT cutoff_at,instrument_version_ids,accepted_observation_hashes,excluded,source_rights_refs,has_gap
                FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
            """), {"hash": snapshot.snapshot_hash})).mappings().first()
            if not stored or tuple(stored["instrument_version_ids"]) != snapshot.instrument_version_ids \
                    or tuple(stored["accepted_observation_hashes"]) != snapshot.accepted_observation_hashes \
                    or stored["excluded"] != body["excluded"] \
                    or tuple(stored["source_rights_refs"]) != snapshot.source_rights_refs \
                    or stored["has_gap"] != snapshot.has_gap or stored["cutoff_at"] != snapshot.cutoff_at:
                raise ObservationConflict("Evidence snapshot identity conflicts with stored contents")
        return snapshot.snapshot_hash
