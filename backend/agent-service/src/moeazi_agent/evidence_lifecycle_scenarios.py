from __future__ import annotations

from datetime import datetime

from .evidence_lifecycle_contracts import CopyDispositionReceipt, LifecycleScope
from .evidence_lifecycle_deletion import (
    LifecycleTombstone, aggregate_deletion, digest, validate_restore,
)
from .evidence_lifecycle_evaluator import evaluate_persistence
from .test_center import canonical_hash
from .evidence_lifecycle_registry import SINK_OWNERS, policy_for


def _copy_receipt(artifact_id: str, schedule_hash: str, copy_id: str, status: str, now: datetime,
        revision: int = 1, predecessor_hash: str | None = None):
    body = {"artifact_id": artifact_id, "scope_key": "public",
        "schedule_hash": schedule_hash, "copy_id": copy_id,
        "owner_id": SINK_OWNERS[copy_id],
        "revision": revision, "predecessor_hash": predecessor_hash, "status": status,
        "evidence_reference": "synthetic_fixture",
        "observed_at": now.isoformat().replace("+00:00", "Z")}
    receipt_hash = digest(body)
    return CopyDispositionReceipt.model_validate({**body,
        "receipt_id": f"ecd_{receipt_hash[:48]}", "receipt_hash": receipt_hash})


def evaluate_lifecycle_fixture(fixture: dict, mode: str, now: datetime) -> dict:
    fixture_hash = canonical_hash(fixture)
    operation = fixture["operation"]
    if operation in {"persist", "provider_request"}:
        decision, sanitized, receipts, schedule = evaluate_persistence(
            producer=fixture["producer"], purpose=fixture["purpose"], sink=fixture["sink"],
            scope=LifecycleScope.model_validate(fixture["scope"]), payload=fixture["payload"],
            artifact_id=f"artifact:{fixture['id']}",
            idempotency_key=f"fixture:{fixture['id']}", observed_at=now)
        result = {"actualOutcome": decision.outcome, "decisionHash": decision.decision_hash,
            "policyHash": decision.policy_hash, "classes": sorted(set(
                receipt.data_class.value for receipt in receipts)),
            "retainedBytes": len(str(sanitized).encode()),
            "droppedBytes": max(0, len(str(fixture["payload"]).encode()) - len(str(sanitized).encode())),
            "expectedCopies": len(schedule.expected_copies) if schedule else 0,
            "resolvedCopies": 0, "reasons": decision.reasons}
    elif operation == "delete":
        schedule_hash = canonical_hash({"fixture": fixture_hash, "schedule": "retention"})
        receipts = [_copy_receipt(fixture["artifactId"], schedule_hash, copy_id, status, now)
            for copy_id, status in fixture.get("copyStatuses", {}).items()]
        receipts.extend(_copy_receipt(fixture["artifactId"], schedule_hash, item["copyId"],
            item["status"], now, item["revision"], item.get("predecessorHash"))
            for item in fixture.get("receiptSequence", []))
        route = fixture["policyRoute"]
        policy = policy_for(route[0], route[1], route[2])
        deletion = aggregate_deletion(
            fixture["artifactId"], policy.policy_hash, schedule_hash, receipts, now)
        result = {"actualOutcome": deletion.outcome, "decisionHash": deletion.receipt_hash,
            "policyHash": policy.policy_hash, "classes": [], "retainedBytes": 0, "droppedBytes": 0,
            "expectedCopies": len(policy.expected_copies),
            "resolvedCopies": sum(receipt.status.startswith("verified") for receipt in receipts),
            "reasons": deletion.reason_codes}
    elif operation == "expire":
        held = bool(fixture["holdActive"])
        outcome = "block" if held else "allow"
        result = {"actualOutcome": outcome, "decisionHash": canonical_hash(
            {"fixture": fixture_hash, "held": held}), "policyHash": "0" * 64,
            "classes": [], "retainedBytes": 1 if held else 0,
            "droppedBytes": 0 if held else 1, "expectedCopies": 1,
            "resolvedCopies": 0, "reasons": ["hold_active" if held else "retention_due"]}
    else:
        policy_hash = "a" * 64
        tombstone = None
        if fixture["deleted"]:
            body = {"artifact_id": fixture["artifactId"], "scope_key": "public",
                "copy_id": "timescale.evidence_body",
                "cutoff_at": now.isoformat(), "policy_hash": policy_hash,
                "inventory_hash": "b" * 64, "copy_receipt_hash": "c" * 64,
                "body_present": False}
            tombstone_hash = digest(body)
            tombstone = LifecycleTombstone.model_validate({**body,
                "tombstone_id": f"elt_{tombstone_hash[:48]}", "tombstone_hash": tombstone_hash})
        validation = validate_restore(artifact_id=fixture["artifactId"],
            current_policy_hash=policy_hash,
            restored_policy_hash=policy_hash if fixture["policyMatches"] else "d" * 64,
            inventory_hash="b" * 64 if fixture["inventoryKnown"] else None,
            tombstone=tombstone, scope_matches=fixture["scopeMatches"], evaluated_at=now)
        result = {"actualOutcome": validation.outcome, "decisionHash": validation.validation_hash,
            "policyHash": policy_hash, "classes": [], "retainedBytes": 0, "droppedBytes": 0,
            "expectedCopies": 1, "resolvedCopies": 0, "reasons": validation.reason_codes}
    verdict = "pass" if result["actualOutcome"] == fixture["expectedOutcome"] else "fail"
    baseline = evaluate_legacy_baseline(fixture)
    return {"scenarioId": fixture["id"], "fixtureHash": fixture_hash,
        "mode": mode, "expectedOutcome": fixture["expectedOutcome"],
        "baselineOutcome": baseline, "candidateOutcome": result["actualOutcome"],
        "invariantVerdict": verdict, **result}


def evaluate_legacy_baseline(fixture: dict) -> str:
    """Bounded executable model of the frozen pre-boundary behavior."""
    operation = fixture["operation"]
    if operation in {"persist", "provider_request"}:
        return "allow" if isinstance(fixture.get("payload"), dict) else "block"
    if operation == "delete":
        statuses = list(fixture.get("copyStatuses", {}).values())
        return "verified" if statuses and all(status != "pending" for status in statuses) else "partial"
    if operation == "expire":
        return "allow"
    if operation == "restore_validate":
        return "allow"
    return "block"
