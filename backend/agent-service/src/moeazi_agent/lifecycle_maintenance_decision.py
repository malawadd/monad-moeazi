"""Deterministic close evidence discovery, independent of research availability."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_dataset import load_dataset
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import EvidenceSnapshot, canonical_hash


async def ensure_maintenance_decision(conn, scope, run: dict, account: dict,
                                      instrument_id: str) -> ReplayDecisionContext | None:
    """Caller holds account/run locks; the resulting identity grants no authority.

    Select stored evidence from the frozen prefix. Equally recent conflicting
    books fail closed. No provider, strategy evaluation or new market IO occurs.
    The financial writer separately validates the account observation and sizing.
    """
    manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
    if manifest.scope != scope or manifest.run_id != run["run_id"] or \
            manifest.manifest_hash != run["manifest_hash"] or \
            instrument_id not in manifest.instrument_version_ids or \
            account["reconciliation_state"] != "clean" or \
            account["observation_snapshot_hash"] is None:
        raise FinanceError("Maintenance evidence lacks exact reconciled run identity")
    dataset = await load_dataset(conn, manifest)
    cursor = run["replay_cursor_at"]
    prefix = {canonical_hash(item.model_dump(mode="json")): item for item in dataset
              if item.event_at <= item.available_at <= cursor}
    rows = (await conn.execute(text("""
        WITH eligible AS (
          SELECT * FROM observation_evidence_snapshots
          WHERE NOT has_gap AND cutoff_at>=:start AND cutoff_at<=:cursor
            AND instrument_version_ids @> CAST(:instrument AS jsonb)
            AND accepted_observation_hashes <@ CAST(:prefix AS jsonb)
        ) SELECT * FROM eligible WHERE cutoff_at=(SELECT max(cutoff_at) FROM eligible)
        ORDER BY snapshot_hash LIMIT 2
    """), {"start": manifest.scenario.evidence_cutoff_at, "cursor": cursor,
           "instrument": json.dumps([instrument_id]),
           "prefix": json.dumps(sorted(prefix))})).mappings().all()
    if not rows:
        return None
    if len(rows) != 1:
        raise FinanceError("Maintenance has ambiguous equally recent evidence snapshots")
    row = rows[0]
    evidence = EvidenceSnapshot(schema_version=1, cutoff_at=row["cutoff_at"],
        instrument_version_ids=tuple(row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(row["accepted_observation_hashes"]),
        excluded=tuple(row["excluded"]), source_rights_refs=tuple(row["source_rights_refs"]),
        has_gap=row["has_gap"], snapshot_hash=row["snapshot_hash"])
    if canonical_hash(evidence.model_dump(mode="json", exclude={"snapshot_hash"})) != evidence.snapshot_hash:
        raise FinanceError("Maintenance evidence snapshot hash differs")
    books = [item for item in prefix.values() if item.instrument_version_id == instrument_id
             and item.available_at <= evidence.cutoff_at]
    if not books:
        return None
    latest_time = max((item.available_at, item.event_at) for item in books)
    latest = [item for item in books if (item.available_at, item.event_at) == latest_time]
    if len(latest) != 1:
        raise FinanceError("Maintenance evidence has conflicting equally recent books")
    if (cursor - latest[0].event_at).total_seconds() * 1000 > manifest.scenario.max_book_age_ms:
        return None
    decision, _ = build_replay_decision(manifest, dataset, cursor, evidence,
        instrument_version_id=instrument_id,
        account_snapshot_hash=account["observation_snapshot_hash"])
    params = {**_run_params(scope, manifest.run_id), "hash": decision.decision_hash}
    previous = (await conn.execute(text("""
        SELECT decision_json FROM simulation_decision_contexts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND decision_hash=:hash
    """), params)).scalar_one_or_none()
    body = decision.model_dump(mode="json")
    if previous is not None:
        if previous != body or ReplayDecisionContext.model_validate_json(json.dumps(previous)) != decision:
            raise FinanceError("Maintenance decision identity conflicts")
        return decision
    await conn.execute(text("""
        INSERT INTO simulation_decision_contexts(environment,scope_id,strategy_account_id,
          run_id,decision_hash,decision_json,instrument_version_id,cursor_at,
          evidence_cutoff_at,evidence_snapshot_hash,account_snapshot_hash,dataset_prefix_count)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:hash,CAST(:body AS jsonb),
          :instrument,:cursor,:cutoff,:evidence,:account,:prefix)
    """), {**params, "body": json.dumps(body, sort_keys=True, separators=(",", ":")),
           "instrument": instrument_id, "cursor": cursor, "cutoff": evidence.cutoff_at,
           "evidence": evidence.snapshot_hash,
           "account": account["observation_snapshot_hash"],
           "prefix": decision.dataset_prefix_count})
    return decision
