"""Resolve the exact current replay decision for a prepared/submitted order."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_contracts import TradeIntent
from .lifecycle_dataset import load_dataset
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import EvidenceSnapshot, MarketObservation


async def resolve_order_decision(conn, manifest: SimulationRunManifest,
                                 run: dict, account: dict, intent: TradeIntent
                                 ) -> tuple[ReplayDecisionContext | None, MarketObservation]:
    """Only SQL-persisted current context may replace the manifest baseline."""
    cursor = run["replay_cursor_at"]
    snapshot_hash = account["observation_snapshot_hash"]
    if account["reconciliation_state"] != "clean" or not snapshot_hash or \
            intent.scope != manifest.scope or intent.run_id != manifest.run_id or \
            intent.run_manifest_hash != manifest.manifest_hash or \
            intent.controller_ref != manifest.controller_ref or \
            intent.controller_mode != manifest.controller_mode or \
            intent.instrument_version_id not in manifest.instrument_version_ids or \
            intent.expires_at_cursor <= cursor:
        raise FinanceError("order decision lacks current scope, exposure, or cursor")
    context = None
    if intent.decision_context_hash is None:
        if cursor != manifest.scenario.simulation_cursor_at or \
                intent.evidence_snapshot_hash != manifest.evidence_snapshot_hash or \
                snapshot_hash != manifest.account_snapshot_hash:
            raise FinanceError("later order requires a persisted replay decision")
    else:
        params = _run_params(manifest.scope, manifest.run_id)
        row = (await conn.execute(text("""
            SELECT decision_json FROM simulation_decision_contexts
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND decision_hash=:hash
        """), {**params, "hash": intent.decision_context_hash})).mappings().first()
        if row is None:
            raise FinanceError("order decision context was not persisted")
        context = ReplayDecisionContext.model_validate_json(json.dumps(row["decision_json"]))
        if context.decision_hash != intent.decision_context_hash or \
                context.scope != manifest.scope or context.run_id != manifest.run_id or \
                context.run_manifest_hash != manifest.manifest_hash or \
                context.controller_ref != manifest.controller_ref or \
                context.instrument_version_id != intent.instrument_version_id or \
                context.cursor_at != cursor or \
                context.evidence_snapshot_hash != intent.evidence_snapshot_hash or \
                context.account_snapshot_hash != snapshot_hash:
            raise FinanceError("order decision differs from current frozen checkpoint")
    evidence_row = (await conn.execute(text("""
        SELECT cutoff_at,instrument_version_ids,accepted_observation_hashes,
               excluded,source_rights_refs,has_gap
        FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
    """), {"hash": intent.evidence_snapshot_hash})).mappings().first()
    if evidence_row is None:
        raise FinanceError("order decision evidence is missing")
    evidence = EvidenceSnapshot(schema_version=1,
        cutoff_at=evidence_row["cutoff_at"],
        instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
        excluded=tuple(evidence_row["excluded"]),
        source_rights_refs=tuple(evidence_row["source_rights_refs"]),
        has_gap=evidence_row["has_gap"], snapshot_hash=intent.evidence_snapshot_hash)
    expected, selected = build_replay_decision(manifest, await load_dataset(conn, manifest),
        cursor, evidence, instrument_version_id=intent.instrument_version_id,
        account_snapshot_hash=snapshot_hash)
    if context is not None and context != expected:
        raise FinanceError("stored order decision differs from immutable evidence prefix")
    return context, selected
