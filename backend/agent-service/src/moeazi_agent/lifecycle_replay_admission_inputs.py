"""Resolve immutable Q4 sizing inputs from the scoped financial and source stores."""
from __future__ import annotations

import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest
from .finance_observation_contracts import account_snapshot_from_row
from .finance_policy import SizingPolicy
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_dataset import load_dataset
from .lifecycle_entry_progress import load_entry_progress
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_strategy import ReplayStrategyDraft
from .observation_contracts import EvidenceSnapshot, InstrumentVersion, canonical_hash


async def load_replay_financial_inputs(conn, scope: FinanceScope,
                                       run: dict, account: dict, request: dict) -> dict:
    """Caller holds account/run locks; a frozen evaluation is never recomputed."""
    manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
    params = _run_params(scope, manifest.run_id)
    progress = await load_entry_progress(conn, scope, manifest.run_id,
        manifest.manifest_hash, request["request_id"], "evaluation")
    if not progress or progress["requestHash"] != request["request_hash"] or \
            manifest.scope != scope or manifest.manifest_hash != run["manifest_hash"]:
        raise FinanceError("replay financial admission lacks immutable evaluation")
    decision = ReplayDecisionContext.model_validate_json(json.dumps(progress["decision"]))
    draft = ReplayStrategyDraft.model_validate_json(json.dumps(progress["draft"]))
    instrument = InstrumentVersion.model_validate_json(json.dumps(progress["instrument"]))
    if draft.action == "hold" or draft.run_manifest_hash != manifest.manifest_hash or \
            draft.evidence_snapshot_hash != decision.evidence_snapshot_hash or \
            draft.instrument_version_id != decision.instrument_version_id or \
            draft.instrument_version_id != instrument.instrument_version_id or \
            draft.evaluated_at != decision.cursor_at or \
            decision.account_snapshot_hash != account["observation_snapshot_hash"] or \
            decision.cursor_at != run["replay_cursor_at"]:
        raise FinanceError("frozen replay decision or account checkpoint expired")
    if account["reconciliation_state"] != "clean" or \
            account["admission_state"] != "open" or run["entries_stopped"] or \
            account["authority_epoch"] != run["authority_epoch"] or \
            account["policy_version"] != manifest.policy_version or \
            account["policy_hash"] != manifest.policy_hash:
        raise FinanceError("financial admission is stopped or unreconciled")
    decision_row = (await conn.execute(text("""
        SELECT decision_json FROM simulation_decision_contexts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND decision_hash=:hash
    """), {**params, "hash": decision.decision_hash})).mappings().first()
    if not decision_row or ReplayDecisionContext.model_validate_json(
            json.dumps(decision_row["decision_json"])) != decision:
        raise FinanceError("replay decision was not registered")
    instrument_row = (await conn.execute(text("""
        SELECT manifest,registry_hash FROM observation_instrument_versions
        WHERE instrument_version_id=:instrument
    """), {"instrument": instrument.instrument_version_id})).mappings().first()
    if not instrument_row or instrument_row["registry_hash"] != instrument.registry_hash or \
            InstrumentVersion.model_validate_json(json.dumps(instrument_row["manifest"])) != instrument:
        raise FinanceError("stored instrument differs from evaluated instrument")
    evidence_row = (await conn.execute(text("""
        SELECT * FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
    """), {"hash": decision.evidence_snapshot_hash})).mappings().first()
    if not evidence_row:
        raise FinanceError("replay evidence snapshot is missing")
    evidence = EvidenceSnapshot(schema_version=1,
        cutoff_at=evidence_row["cutoff_at"],
        instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
        excluded=tuple(evidence_row["excluded"]),
        source_rights_refs=tuple(evidence_row["source_rights_refs"]),
        has_gap=evidence_row["has_gap"], snapshot_hash=evidence_row["snapshot_hash"])
    if canonical_hash(evidence.model_dump(mode="json", exclude={"snapshot_hash"})) != \
            evidence.snapshot_hash:
        raise FinanceError("stored replay evidence hash differs")
    dataset = await load_dataset(conn, manifest)
    rebuilt, book = build_replay_decision(manifest, dataset, decision.cursor_at,
        evidence, instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=account["observation_snapshot_hash"])
    if rebuilt != decision or \
            canonical_hash(book.model_dump(mode="json")) != draft.observation_hash:
        raise FinanceError("frozen strategy signal is no longer the selected source")
    snapshot_row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
    """), {"hash": account["observation_snapshot_hash"]})).mappings().first()
    if snapshot_row is None:
        raise FinanceError("admitted financial account snapshot is missing")
    snapshot = account_snapshot_from_row(snapshot_row)
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash or \
            snapshot.scope != scope or \
            snapshot.source_account_id != account["source_account_id"] or \
            snapshot.status != "accepted" or snapshot.finality != "admitted_final" or \
            snapshot.has_gap or snapshot.has_reorg or not snapshot.balances_complete or \
            not snapshot.positions_complete or snapshot.cutoff_at > decision.cursor_at:
        raise FinanceError("financial snapshot lacks replay admission provenance")
    if snapshot.origin == "simulation_derived":
        parent = (await conn.execute(text("""
            SELECT 1 FROM simulation_derived_snapshots
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND snapshot_hash=:snapshot AND manifest_hash=:manifest
        """), {**params, "snapshot": snapshot.snapshot_hash,
               "manifest": manifest.manifest_hash})).first()
        if not parent or snapshot.rights_ref != "local_simulation_fixture_only":
            raise FinanceError("derived financial snapshot lacks the source run")
    elif (snapshot.origin, snapshot.rights_ref) not in {
            ("recorded_fixture", "internal_qualification_only"),
            ("native_verified", "internal_qualification_only")}:
        raise FinanceError("financial opening source rights are unqualified")
    policy_row = (await conn.execute(text("""
        SELECT policy_json,policy_hash FROM finance_policy_versions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND policy_version=:version
    """), {**params, "version": manifest.policy_version})).mappings().first()
    if not policy_row or policy_row["policy_hash"] != manifest.policy_hash:
        raise FinanceError("financial policy differs from run manifest")
    policy = SizingPolicy.model_validate_json(json.dumps(policy_row["policy_json"]))
    if policy.policy_hash != manifest.policy_hash:
        raise FinanceError("stored financial policy content differs")
    observed_age = (decision.cursor_at - snapshot.event_at).total_seconds()
    if observed_age < 0 or observed_age > policy.max_observation_age_seconds:
        raise FinanceError("financial replay snapshot is stale at the decision cursor")
    position_rows = (await conn.execute(text("""
        SELECT run_id,arithmetic_state_json,arithmetic_state_hash
        FROM simulation_positions WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), params)).mappings().all()
    positions = []
    for row in position_rows:
        state = PositionArithmeticState.model_validate_json(
            json.dumps(row["arithmetic_state_json"]))
        if row["run_id"] != manifest.run_id or \
                _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json")) != \
                row["arithmetic_state_hash"]:
            raise FinanceError("another run position or altered arithmetic blocks entry")
        positions.append(state)
    pending_rows = (await conn.execute(text("""
        SELECT r.calculation_receipt_hash,c.receipt_json
        FROM finance_reservations r JOIN finance_calculation_receipts c
          ON c.environment=r.environment AND c.scope_id=r.scope_id
          AND c.strategy_account_id=r.strategy_account_id
          AND c.receipt_hash=r.calculation_receipt_hash
        WHERE r.environment=:environment AND r.scope_id=:scope_id
          AND r.strategy_account_id=:strategy_account_id AND r.purpose='trade'
          AND r.status IN ('reserved','submitted','uncertain')
    """), params)).mappings().all()
    pending = []
    for row in pending_rows:
        receipt = ReplaySizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
        if receipt.receipt_hash != row["calculation_receipt_hash"]:
            raise FinanceError("pending replay risk receipt hash differs")
        pending.append(receipt)
    return {"manifest": manifest, "decision": decision, "draft": draft,
            "instrument": instrument, "book": book, "evidence": evidence,
            "dataset": dataset, "snapshot": snapshot,
            "policy": policy, "positions": tuple(positions),
            "pending_receipts": tuple(pending)}
