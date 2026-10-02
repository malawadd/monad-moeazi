"""Load only frozen, current-cursor evidence for an owner-requested close."""
from __future__ import annotations

import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest, db_native_int
from .finance_observation_contracts import account_snapshot_from_row
from .finance_policy import SizingPolicy
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_dataset import load_dataset
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import EvidenceSnapshot, InstrumentVersion, canonical_hash


async def load_maintenance_inputs(conn, scope: FinanceScope, run: dict,
                                  account: dict, instrument_id: str,
                                  decision_hash: str) -> dict:
    """Load the exact server-selected decision at the durable replay cursor."""
    manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
    params = _run_params(scope, manifest.run_id)
    if manifest.scope != scope or manifest.manifest_hash != run["manifest_hash"] or \
            account["reconciliation_state"] != "clean" or \
            account["admission_state"] not in {"open", "stopped"} or \
            account["observation_snapshot_hash"] is None or \
            account["policy_version"] != manifest.policy_version or \
            account["policy_hash"] != manifest.policy_hash:
        raise FinanceError("maintenance lacks a clean current financial account")
    rows = (await conn.execute(text("""
        SELECT decision_json FROM simulation_decision_contexts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND instrument_version_id=:instrument AND cursor_at=:cursor
          AND account_snapshot_hash=:snapshot
          AND decision_hash=:decision_hash
    """), {**params, "instrument": instrument_id,
           "cursor": run["replay_cursor_at"],
           "snapshot": account["observation_snapshot_hash"],
           "decision_hash": decision_hash})).mappings().all()
    if not rows:
        raise FinanceError("maintenance selected decision is not registered")
    if len(rows) != 1:
        raise FinanceError("maintenance decision is ambiguous at current cursor")
    decision = ReplayDecisionContext.model_validate_json(
        json.dumps(rows[0]["decision_json"]))
    if decision.scope != scope or decision.run_id != manifest.run_id or \
            decision.run_manifest_hash != manifest.manifest_hash or \
            decision.decision_hash != decision_hash or \
            decision.instrument_version_id != instrument_id or \
            decision.cursor_at != run["replay_cursor_at"] or \
            decision.account_snapshot_hash != account["observation_snapshot_hash"]:
        raise FinanceError("maintenance decision row differs from current run")
    instrument_row = (await conn.execute(text("""
        SELECT manifest,registry_hash FROM observation_instrument_versions
        WHERE instrument_version_id=:instrument
    """), {"instrument": instrument_id})).mappings().first()
    if instrument_row is None:
        raise FinanceError("maintenance instrument version is missing")
    instrument = InstrumentVersion.model_validate_json(
        json.dumps(instrument_row["manifest"]))
    if instrument.registry_hash != instrument_row["registry_hash"]:
        raise FinanceError("maintenance instrument registry differs")
    evidence_row = (await conn.execute(text("""
        SELECT * FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
    """), {"hash": decision.evidence_snapshot_hash})).mappings().first()
    if evidence_row is None:
        raise FinanceError("maintenance evidence snapshot is missing")
    evidence = EvidenceSnapshot(schema_version=1,
        cutoff_at=evidence_row["cutoff_at"],
        instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
        accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
        excluded=tuple(evidence_row["excluded"]),
        source_rights_refs=tuple(evidence_row["source_rights_refs"]),
        has_gap=evidence_row["has_gap"], snapshot_hash=evidence_row["snapshot_hash"])
    if canonical_hash(evidence.model_dump(mode="json", exclude={"snapshot_hash"})) != \
            evidence.snapshot_hash:
        raise FinanceError("maintenance evidence hash differs")
    dataset = await load_dataset(conn, manifest)
    rebuilt, book = build_replay_decision(manifest, dataset, decision.cursor_at,
        evidence, instrument_version_id=instrument_id,
        account_snapshot_hash=account["observation_snapshot_hash"])
    if rebuilt != decision:
        raise FinanceError("maintenance decision differs from frozen source prefix")
    snapshot_row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
    """), {"hash": account["observation_snapshot_hash"]})).mappings().first()
    if snapshot_row is None:
        raise FinanceError("maintenance account observation is missing")
    snapshot = account_snapshot_from_row(snapshot_row)
    if snapshot.scope != scope or account_snapshot_hash(snapshot) != snapshot.snapshot_hash or \
            snapshot.source_account_id != account["source_account_id"] or \
            snapshot.status != "accepted" or snapshot.finality != "admitted_final" or \
            snapshot.has_gap or snapshot.has_reorg or not snapshot.balances_complete or \
            not snapshot.positions_complete or snapshot.cutoff_at > decision.cursor_at:
        raise FinanceError("maintenance account snapshot lacks final provenance")
    if snapshot.origin == "simulation_derived":
        parent = (await conn.execute(text("""
            SELECT 1 FROM simulation_derived_snapshots
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND snapshot_hash=:snapshot AND manifest_hash=:manifest
        """), {**params, "snapshot": snapshot.snapshot_hash,
               "manifest": manifest.manifest_hash})).first()
        if not parent or snapshot.rights_ref != "local_simulation_fixture_only":
            raise FinanceError("maintenance derived snapshot lacks source run")
    elif (snapshot.origin, snapshot.rights_ref) not in {
            ("recorded_fixture", "internal_qualification_only"),
            ("native_verified", "internal_qualification_only")}:
        raise FinanceError("maintenance opening rights are unqualified")
    policy_row = (await conn.execute(text("""
        SELECT policy_json,policy_hash FROM finance_policy_versions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND policy_version=:version
    """), {**params, "version": manifest.policy_version})).mappings().first()
    if policy_row is None or policy_row["policy_hash"] != manifest.policy_hash:
        raise FinanceError("maintenance financial policy differs")
    policy = SizingPolicy.model_validate_json(json.dumps(policy_row["policy_json"]))
    age = (decision.cursor_at - snapshot.event_at).total_seconds()
    if policy.policy_hash != manifest.policy_hash or age < 0 or \
            age > policy.max_observation_age_seconds:
        raise FinanceError("maintenance financial evidence is stale at replay cursor")
    rows = (await conn.execute(text("""
        SELECT run_id,instrument_version_id,location_id,revision,
          signed_exposure_units,reconciliation_state,arithmetic_state_json,
          arithmetic_state_hash FROM simulation_positions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), params)).mappings().all()
    states = []
    selected = None
    for row in rows:
        if row["arithmetic_state_json"] is None:
            raise FinanceError("maintenance position lacks rational source state")
        state = PositionArithmeticState.model_validate_json(
            json.dumps(row["arithmetic_state_json"]))
        if row["run_id"] != manifest.run_id or \
                _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json")) != \
                row["arithmetic_state_hash"] or \
                state.location_id != row["location_id"] or \
                state.instrument_version_id != row["instrument_version_id"] or \
                db_native_int(row["signed_exposure_units"]) != \
                int(state.signed_quantity_units):
            raise FinanceError("maintenance position ancestry differs")
        states.append(state)
        if state.instrument_version_id == instrument_id and \
                int(state.signed_quantity_units) != 0:
            if selected is not None or row["reconciliation_state"] != "clean":
                raise FinanceError("maintenance has ambiguous or unclean residual")
            selected = dict(row)
    if selected is None:
        raise FinanceError("maintenance has no nonflat source position")
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
            raise FinanceError("maintenance pending hold lacks known replay receipt")
        pending.append(receipt)
    return {"manifest": manifest, "decision": decision, "instrument": instrument,
            "book": book, "evidence": evidence, "dataset": dataset,
            "snapshot": snapshot, "policy": policy, "positions": tuple(states),
            "position_row": selected, "pending_receipts": tuple(pending)}
