from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from functools import lru_cache
import json
from typing import Any

from .dependency_safety_contracts import digest
from .recovery_contracts import (
    BackupEvidenceReceipt, CrossStateFinding, CrossStateReconciliationDecision,
    ReadOnlyResumeReceipt,
    RecoveryPointSet, RecoveryReadinessVerdict,
)
from .recovery_drill_contracts import RecoveryDrillPlan, RecoveryDrillReceipt
from .recovery_restore_contracts import (
    DomainRestoreResult, IsolatedRestorePlan, RestoreAttemptReceipt,
)
from .recovery_registry import DOMAIN_IDS, READINESS_TTL_SECONDS, registry_hash

REPOSITORY_REVISION = "f59c77c00e6b72c9c069af2b80de4647ee790287"
MIGRATION_HASH = digest({"migrations": "001-009"})
SCHEMA_HASH = digest({"schema": "recovery-v1"})
CONFIG_HASH = digest({"configuration": "synthetic-safe"})
READ_ONLY_OPERATIONS = ["inspection", "render_previous_safe", "read_only_reconcile"]
PROHIBITED_OPERATIONS = ["provider_dispatch", "credit_reservation", "proposal", "approval",
    "execution", "signing", "broadcast", "external_mutation", "authority_relaxation"]
COMPARISONS = ("jobs_credits", "proposals_approvals_fills", "workflows_schedules",
    "release_configuration", "executions_nonces_uncertainty", "redis_reconstruction")
COMPARISON_DOMAINS = {
    "jobs_credits": ("convex_product_state", "timescale_history"),
    "proposals_approvals_fills": ("convex_product_state", "timescale_history", "external_execution_state"),
    "workflows_schedules": ("temporal_workflows", "convex_product_state"),
    "release_configuration": ("repository_release",),
    "executions_nonces_uncertainty": ("external_execution_state", "timescale_history"),
    "redis_reconstruction": ("redis_coordination", "convex_product_state", "timescale_history"),
}


def _seal(prefix: str, body: dict[str, Any], id_field: str) -> dict[str, Any]:
    canonical_hash = digest(body)
    return {**body, id_field: f"{prefix}_{canonical_hash[:48]}",
        "canonical_hash": canonical_hash}


def verify_recovery_artifact(model: Any, id_field: str, prefix: str) -> None:
    body = model.model_dump(mode="python")
    actual_hash = body.pop("canonical_hash"); actual_id = body.pop(id_field)
    expected = digest(body)
    if actual_hash != expected or actual_id != f"{prefix}_{expected[:48]}":
        raise ValueError("Recovery artifact canonical identity is invalid")


def _receipt(run_id: str, tenant_key: str, domain: str, now: datetime,
             faults: set[str]) -> BackupEvidenceReceipt:
    reason = "verified"; verified = True; proof = "local_fixture"; gaps: list[str] = []
    cutoff = now - timedelta(seconds=30)
    fault_map = {
        "convex_product_state": (("missing_convex", "evidence_missing"),
            ("stale_convex", "evidence_unverified")),
        "timescale_history": (("corrupt_timescale", "checksum_mismatch"),
            ("evidence_gap", "evidence_gap")),
        "temporal_workflows": (("missing_temporal_history", "history_missing"),),
        "repository_release": (("release_skew", "schema_skew"),),
        "redis_coordination": (("redis_as_truth", "redis_used_as_truth"),),
        "external_execution_state": (("unresolved_submission", "unresolved_submission"),
            ("missing_execution_state", "evidence_missing")),
        "non_owner_secret_custody": (("missing_secret_custody", "future_owner_missing"),),
    }
    for fault, code in fault_map.get(domain, ()):
        if fault in faults:
            verified = False; reason = code; gaps = [code]
    if "cutoff_disagreement" in faults and domain == "convex_product_state":
        cutoff = now - timedelta(seconds=7200); verified = False
        reason = "cutoff_disagreement"; gaps = ["cutoff_disagreement"]
    body = {"schema_version": 1, "run_id": run_id, "domain_id": domain,
        "tenant_key": tenant_key, "cutoff_at": cutoff,
        "opaque_sequence_hash": digest({"domain": domain, "sequence": 1}),
        "repository_revision": REPOSITORY_REVISION,
        "schema_revision_hash": SCHEMA_HASH, "configuration_revision_hash": CONFIG_HASH,
        "item_count": 0 if domain == "redis_coordination" else 3,
        "checksum": digest({"domain": domain, "fixture": "v1"}),
        "proof_class": proof, "verified": verified, "reason_codes": [reason],
        "gaps": gaps, "captured_at": now}
    return BackupEvidenceReceipt(**_seal("ber", body, "receipt_id"))


def _point_set(run_id: str, tenant_key: str, receipts: list[BackupEvidenceReceipt],
               now: datetime, faults: set[str]) -> RecoveryPointSet:
    reasons = [item.reason_codes[0] for item in receipts if not item.verified]
    cutoffs = {item.domain_id: item.cutoff_at for item in receipts}
    actual = [item for item in cutoffs.values() if item is not None]
    spread = int((max(actual) - min(actual)).total_seconds()) if actual else None
    if spread is not None and spread > 3600:
        reasons.append("cutoff_disagreement")
    body = {"schema_version": 1, "run_id": run_id, "tenant_key": tenant_key,
        "registry_hash": registry_hash(),
        "receipt_hashes": sorted(item.canonical_hash for item in receipts),
        "receipt_bindings": {item.domain_id: item.canonical_hash for item in receipts},
        "domain_cutoffs": cutoffs, "cutoff_spread_seconds": spread,
        "coverage": "blocked" if reasons else "complete",
        "reason_codes": sorted(set(reasons)), "frozen_at": now}
    return RecoveryPointSet(**_seal("rps", body, "point_set_id"))


def _restore(point: RecoveryPointSet, receipts: list[BackupEvidenceReceipt], now: datetime,
             faults: set[str]) -> tuple[IsolatedRestorePlan, RestoreAttemptReceipt]:
    plan_body = {"schema_version": 1, "point_set_hash": point.canonical_hash,
        "repository_revision": REPOSITORY_REVISION, "migration_set_hash": MIGRATION_HASH,
        "target": "isolated_fixture", "network_policy": "deny_all",
        "production_writes_allowed": False,
        "steps": ["verify_inputs", "restore_durable_owners", "start_redis_empty",
            "rebuild_redis", "reconcile", "evaluate"],
        "idempotency_key": f"recovery:{point.canonical_hash[:32]}"}
    plan = IsolatedRestorePlan(**_seal("irp", plan_body, "plan_id"))
    results = []
    for receipt in receipts:
        status = "verified" if receipt.verified else (
            "unavailable" if receipt.proof_class == "unavailable" else "blocked")
        results.append(DomainRestoreResult(domain_id=receipt.domain_id,
            evidence_receipt_hash=receipt.canonical_hash, status=status,
            item_count=receipt.item_count, checksum=receipt.checksum,
            reason_codes=receipt.reason_codes, duration_ms=3))
    outbound = 1 if "outbound_attempt" in faults else 0
    writes = 1 if "production_write" in faults else 0
    terminal = "verified" if point.coverage == "complete" and all(
        item.status == "verified" for item in results) and not outbound and not writes else "blocked"
    body = {"schema_version": 1, "plan_hash": plan.canonical_hash,
        "idempotency_key": plan.idempotency_key,
        "domain_results": [item.model_dump(mode="json") for item in results],
        "outbound_attempt_count": outbound, "production_write_count": writes,
        "terminal_result": terminal, "started_at": now,
        "finished_at": now + timedelta(milliseconds=21)}
    return plan, RestoreAttemptReceipt(**_seal("rar", body, "attempt_id"))


def _finding(comparison: str, fault: str | None, evidence_hashes: list[str],
             fixture_hash: str) -> CrossStateFinding:
    reason = fault or "verified"
    expected = digest({"comparison": comparison, "profile": "synthetic-bound-v1",
        "fixtureHash": fixture_hash, "evidenceHashes": evidence_hashes})
    restored = expected if not fault else digest({"expectedHash": expected,
        "observedReason": fault, "evidenceHashes": evidence_hashes})
    body = {"comparison": comparison, "status": "blocked" if fault else "match",
        "reason_code": reason, "evidence_hashes": evidence_hashes,
        "left_hash": expected, "right_hash": restored}
    return CrossStateFinding(**_seal("csf", body, "finding_id"))


def _reconcile(restore: RestoreAttemptReceipt, now: datetime, faults: set[str],
               fixture_hash: str) -> tuple[list[CrossStateFinding], CrossStateReconciliationDecision]:
    mapped = {"jobs_credits": "wrong_tenant" if "wrong_tenant" in faults else None,
        "proposals_approvals_fills": "duplicate_reservation" if "duplicate_reservation" in faults else None,
        "workflows_schedules": "duplicate_schedule" if "duplicate_schedule" in faults else
            "history_missing" if "missing_temporal_history" in faults else None,
        "release_configuration": "configuration_skew" if "release_skew" in faults else None,
        "executions_nonces_uncertainty": "unresolved_submission" if "unresolved_submission" in faults else None,
        "redis_reconstruction": "redis_used_as_truth" if "redis_as_truth" in faults else None}
    by_domain = {item.domain_id: item for item in restore.domain_results}
    findings = [_finding(item, mapped[item], sorted(
        by_domain[domain].evidence_receipt_hash for domain in COMPARISON_DOMAINS[item]), fixture_hash)
        for item in COMPARISONS]
    reasons = [item.reason_code for item in findings if item.status == "blocked"]
    body = {"restore_receipt_hash": restore.canonical_hash,
        "finding_hashes": [item.canonical_hash for item in findings],
        "outcome": "blocked" if reasons else "consistent", "reason_codes": reasons,
        "evaluated_at": now}
    return findings, CrossStateReconciliationDecision(**_seal("csr", body, "decision_id"))


def _evaluate_recovery_fixture(fixture: dict, now: datetime,
                               control_hash: str | None = None) -> dict:
    if fixture.get("evidenceProfile") != "synthetic-bound-v1":
        raise ValueError("Recovery fixture lacks an explicit synthetic evidence profile")
    faults = set(fixture["faults"]); fixture_hash = digest(fixture)
    run_id = f"recovery_{digest({'fixture': fixture_hash, 'time': now.isoformat()})[:32]}"
    tenant_key = f"tenant_{digest({'tenant': 'synthetic-a'})[:16]}"
    receipts = [_receipt(run_id, tenant_key, domain, now, faults) for domain in DOMAIN_IDS]
    point = _point_set(run_id, tenant_key, receipts, now, faults)
    plan, restore = _restore(point, receipts, now, faults)
    findings, reconciliation = _reconcile(restore, now, faults, fixture_hash)
    read_only = (point.coverage == "complete" and restore.terminal_result == "verified"
        and reconciliation.outcome == "consistent")
    reasons = [] if read_only else sorted(set(point.reason_codes + reconciliation.reason_codes
        + (["outbound_attempted"] if restore.outbound_attempt_count else [])
        + (["production_write_attempted"] if restore.production_write_count else [])))
    readiness_body = {"point_set_hash": point.canonical_hash,
        "restore_receipt_hash": restore.canonical_hash,
        "reconciliation_hash": reconciliation.canonical_hash,
        "read_only_outcome": "ready" if read_only else "blocked",
        "normal_resume_outcome": "blocked",
        "reason_codes": (["read_only_ready", "normal_resume_prohibited"] if read_only
            else reasons + ["normal_resume_prohibited"]),
        "readiness_ttl_seconds": READINESS_TTL_SECONDS,
        "evaluated_at": now, "expires_at": now + timedelta(seconds=READINESS_TTL_SECONDS)}
    readiness = RecoveryReadinessVerdict(**_seal("rrv", readiness_body, "verdict_id"))
    resume = None
    if read_only:
        resume_body = {"readiness_hash": readiness.canonical_hash,
            "allowed_operations": READ_ONLY_OPERATIONS,
            "prohibited_operations": PROHIBITED_OPERATIONS,
            "expires_at": readiness.expires_at}
        resume = ReadOnlyResumeReceipt(**_seal("ror", resume_body, "receipt_id"))
    frozen_control_hash = control_hash or digest({"fixtureControl": fixture_hash})
    drill_plan_body = {"scenario_id": fixture["id"], "fixture_hash": fixture_hash,
        "repository_revision": REPOSITORY_REVISION, "registry_hash": registry_hash(),
        "control_hash": frozen_control_hash, "frozen_at": now,
        "network_policy": "deny_all", "cost_ceiling_microusd": 0}
    drill_plan = RecoveryDrillPlan(**_seal("rdp", drill_plan_body, "plan_id"))
    artifact_hashes = [drill_plan.canonical_hash] + [item.canonical_hash for item in receipts] + [point.canonical_hash,
        plan.canonical_hash, restore.canonical_hash, reconciliation.canonical_hash,
        readiness.canonical_hash] + [item.canonical_hash for item in findings]
    drill_body = {"fixture_hash": fixture_hash, "repository_revision": REPOSITORY_REVISION,
        "artifact_hashes": artifact_hashes,
        "invariant_verdict": "pass" if readiness.read_only_outcome == fixture["expectedReadOnly"] else "fail",
        "measured_rpo_seconds": point.cutoff_spread_seconds, "measured_rto_ms": 42,
        "outbound_attempt_count": 0, "production_write_count": 0}
    drill = RecoveryDrillReceipt(**_seal("rdr", drill_body, "drill_id"))
    # `_seal` already derives every identity from the exact body immediately before
    # strict model construction. Rehashing the complete fixture graph here doubled
    # canonical serialization work on every deterministic replay without validating
    # an external boundary. Persisted/reloaded artifacts use
    # `verify_recovery_artifact` at their actual trust boundary.
    storage_artifacts = [{"kind": "backup_evidence_receipt", "domainId": item.domain_id,
        "canonicalHash": item.canonical_hash, "payload": item.model_dump(mode="json")}
        for item in receipts]
    storage_artifacts += [{"kind": "recovery_drill_plan", "domainId": None,
        "canonicalHash": drill_plan.canonical_hash, "payload": drill_plan.model_dump(mode="json")},
        {"kind": "recovery_point_set", "domainId": None,
            "canonicalHash": point.canonical_hash, "payload": point.model_dump(mode="json")},
        {"kind": "isolated_restore_plan", "domainId": None,
            "canonicalHash": plan.canonical_hash, "payload": plan.model_dump(mode="json")},
        {"kind": "restore_attempt_receipt", "domainId": None,
            "canonicalHash": restore.canonical_hash, "payload": restore.model_dump(mode="json")},
    ]
    storage_artifacts += [{"kind": "cross_state_finding", "domainId": None,
        "canonicalHash": item.canonical_hash, "payload": item.model_dump(mode="json")}
        for item in findings]
    storage_artifacts += [
        {"kind": "reconciliation_decision", "domainId": None,
            "canonicalHash": reconciliation.canonical_hash, "payload": reconciliation.model_dump(mode="json")},
        {"kind": "readiness_verdict", "domainId": None,
            "canonicalHash": readiness.canonical_hash, "payload": readiness.model_dump(mode="json")},
    ]
    if resume:
        storage_artifacts.append({"kind": "read_only_resume_receipt", "domainId": None,
            "canonicalHash": resume.canonical_hash, "payload": resume.model_dump(mode="json")})
    storage_artifacts.append({"kind": "recovery_drill_receipt", "domainId": None,
        "canonicalHash": drill.canonical_hash, "payload": drill.model_dump(mode="json")})
    transitions = ["planned", "evidence_captured", "point_set_frozen", "restore_started"]
    if restore.terminal_result == "verified":
        transitions += ["restore_verified", "reconciling", "evaluated",
            "read_only_ready" if read_only else "blocked", "closed"]
    else:
        transitions += ["blocked", "closed"]
    return {"scenarioId": fixture["id"], "fixtureHash": fixture_hash,
        "tenantKey": tenant_key,
        "baseline": {"outcome": "artifact_readable", "normalResume": "unproven"},
        "candidate": {"readOnlyOutcome": readiness.read_only_outcome,
            "normalResumeOutcome": "blocked", "reasonCodes": readiness.reason_codes},
        "domainResults": [item.model_dump(mode="json") for item in restore.domain_results],
        "findings": [item.model_dump(mode="json") for item in findings],
        "operationImpacts": {"inspection": read_only, "renderPrevious": read_only,
            "readOnlyReconcile": read_only, "propose": False, "submit": False},
        "pointSetHash": point.canonical_hash, "restoreHash": restore.canonical_hash,
        "reconciliationHash": reconciliation.canonical_hash,
        "readinessHash": readiness.canonical_hash,
        "resumeHash": resume.canonical_hash if resume else None,
        "drillHash": drill.canonical_hash, "invariantVerdict": drill.invariant_verdict,
        "measuredRpoSeconds": drill.measured_rpo_seconds,
        "measuredRtoMs": drill.measured_rto_ms,
        "outboundAttempts": restore.outbound_attempt_count,
        "productionWrites": restore.production_write_count,
        "stateTransitions": transitions, "_storageArtifacts": storage_artifacts}


@lru_cache(maxsize=64)
def _cached_recovery_fixture(fixture_json: str, now: datetime,
                             control_hash: str | None) -> dict:
    return _evaluate_recovery_fixture(json.loads(fixture_json), now, control_hash)


def evaluate_recovery_fixture(fixture: dict, now: datetime,
                              control_hash: str | None = None) -> dict:
    """Return an isolated copy of a deterministic checked-in fixture projection."""
    fixture_json = json.dumps(fixture, sort_keys=True, separators=(",", ":"))
    return deepcopy(_cached_recovery_fixture(fixture_json, now, control_hash))
