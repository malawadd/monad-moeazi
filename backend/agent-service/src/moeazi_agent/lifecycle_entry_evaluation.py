"""Evaluate stored rules using stored evidence only; no financial authorization."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest
from .lifecycle_dataset import load_dataset
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_strategy import ReplayStrategyRule, evaluate_replay_strategy
from .observation_contracts import EvidenceSnapshot, InstrumentVersion, canonical_hash


async def evaluate_entry_request(repository, scope, run, request):
    manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
    rule = ReplayStrategyRule.model_validate_json(json.dumps(request["rule_json"]))
    if manifest.scope != scope or manifest.run_id != run["run_id"] or \
            manifest.manifest_hash != run["manifest_hash"] or \
            request["rule_hash"] != rule.rule_hash or \
            manifest.strategy_artifact_hash != rule.rule_hash or \
            request["created_by_subject"] != run["created_by_subject"]:
        raise FinanceError("Stored entry evaluation identity differs")
    request_body = {"scope": scope.model_dump(mode="json"), "runId": run["run_id"],
        "manifestHash": manifest.manifest_hash, "rule": rule.model_dump(mode="json"),
        "createdBySubject": request["created_by_subject"], "requestId": request["request_id"]}
    if _digest("moeazi-simulation-entry-request-v1", request_body) != request["request_hash"]:
        raise FinanceError("Stored entry request hash differs")
    async with repository.finance.engine.connect() as conn:
        dataset = await load_dataset(conn, manifest)
        prefix = [canonical_hash(item.model_dump(mode="json")) for item in dataset
                  if item.available_at <= run["replay_cursor_at"]]
        evidence_row = (await conn.execute(text("""
            SELECT * FROM observation_evidence_snapshots
            WHERE NOT has_gap AND cutoff_at>=:start AND cutoff_at<=:cursor
              AND instrument_version_ids @> CAST(:instrument AS jsonb)
              AND accepted_observation_hashes <@ CAST(:prefix AS jsonb)
            ORDER BY cutoff_at DESC,snapshot_hash LIMIT 1
        """), {"start": manifest.scenario.evidence_cutoff_at,
            "cursor": run["replay_cursor_at"],
            "instrument": json.dumps([rule.instrument_version_id]),
            "prefix": json.dumps(prefix)})).mappings().first()
        instrument_row = (await conn.execute(text("""
            SELECT registry_hash,manifest FROM observation_instrument_versions
            WHERE instrument_version_id=:instrument
        """), {"instrument": rule.instrument_version_id})).mappings().first()
    if evidence_row is None or instrument_row is None:
        raise FinanceError("Current replay evidence or instrument is unavailable")
    evidence = EvidenceSnapshot(schema_version=1,
        cutoff_at=evidence_row["cutoff_at"],
        instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
        excluded=tuple(evidence_row["excluded"]),
        source_rights_refs=tuple(evidence_row["source_rights_refs"]),
        has_gap=evidence_row["has_gap"], snapshot_hash=evidence_row["snapshot_hash"])
    instrument = InstrumentVersion.model_validate(instrument_row["manifest"])
    if instrument.registry_hash != instrument_row["registry_hash"]:
        raise FinanceError("Entry instrument registry body differs")
    decision = await repository.register_replay_decision(scope, manifest.run_id,
        manifest.manifest_hash, instrument.instrument_version_id, evidence.snapshot_hash)
    if decision.cursor_at != run["replay_cursor_at"]:
        raise FinanceError("Replay cursor moved while evaluating entry")
    draft = evaluate_replay_strategy(manifest, instrument, dataset, evidence, rule, decision)
    return {"requestHash": request["request_hash"],
            "decision": decision.model_dump(mode="json"),
            "draft": draft.model_dump(mode="json"),
            "instrument": instrument.model_dump(mode="json")}
