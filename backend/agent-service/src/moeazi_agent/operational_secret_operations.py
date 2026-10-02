from __future__ import annotations

from datetime import datetime

from .operational_secret_contracts import (
    OperationalSecretDescriptor, SecretAccessRequest, digest, with_hash,
)
from .operational_secret_evaluator import evaluate_recovery
from .operational_secret_lifecycle_contracts import (
    CustodyReadinessAssessment, DestructionPlan, DestructionReceipt, RecoveryReceipt,
    RecoveryRequest, RevocationReceipt, RotationPlan, RotationReceipt,
)
from .operational_secret_registry import policy_for, registry_hash, workload_registry_hash


def build_descriptor(*, seed: str, tenant_scope: str, class_id: str, source_owner: str,
                     envelope_version: int = 1, data_key_version: int = 1,
                     kek_version: int = 1, creation_revision: int = 1) -> OperationalSecretDescriptor:
    policy = policy_for(class_id)
    body = {"schema_version": 1, "descriptor_id": f"osc_{digest({'seed': seed, 'tenant': tenant_scope})[:48]}",
        "tenant_scope": tenant_scope, "class_id": class_id, "source_owner": source_owner,
        "state": "active", "envelope_version": envelope_version,
        "data_key_version": data_key_version, "kek_version": kek_version,
        "policy_hash": policy.policy_hash, "workload_registry_hash": workload_registry_hash(),
        "creation_revision": creation_revision}
    return with_hash(OperationalSecretDescriptor, "descriptor_hash", **body)


def build_access_request(*, descriptor: OperationalSecretDescriptor, purpose: str,
                         consumer_id: str, consumer_version: str, capability: str,
                         aad_hash: str, idempotency_key: str, requested_at: datetime,
                         tenant_scope: str | None = None, class_id: str | None = None,
                         envelope_version: int | None = None) -> SecretAccessRequest:
    body = {"schema_version": 1, "tenant_scope": tenant_scope or descriptor.tenant_scope,
        "descriptor_id": descriptor.descriptor_id, "class_id": class_id or descriptor.class_id,
        "purpose": purpose, "consumer_id": consumer_id, "consumer_version": consumer_version,
        "capability": capability, "envelope_version": envelope_version or descriptor.envelope_version,
        "aad_hash": aad_hash, "policy_hash": descriptor.policy_hash,
        "idempotency_key": idempotency_key, "requested_at": requested_at}
    body["request_hash"] = digest({key: value for key, value in body.items() if key != "request_hash"})
    return SecretAccessRequest(**body)


def plan_rotation(descriptor: OperationalSecretDescriptor, target_envelope_version: int,
                  target_data_key_version: int, target_kek_version: int,
                  idempotency_key: str) -> RotationPlan:
    body = {"plan_id": f"orp_{digest({'descriptor': descriptor.descriptor_hash, 'key': idempotency_key})[:48]}",
        "descriptor_id": descriptor.descriptor_id,
        "predecessor_envelope_version": descriptor.envelope_version,
        "target_envelope_version": target_envelope_version,
        "target_data_key_version": target_data_key_version,
        "target_kek_version": target_kek_version, "replacement_proof_hash": None,
        "idempotency_key": idempotency_key}
    if target_envelope_version <= descriptor.envelope_version:
        raise ValueError("Rotation target must advance the envelope version")
    return with_hash(RotationPlan, "plan_hash", **body)


def rotation_receipt(plan: RotationPlan, state: str, now: datetime,
                     predecessor_hash: str | None = None, replacement_verified: bool = False,
                     upstream_status: str = "unknown") -> RotationReceipt:
    if state in {"replacement_verified", "cutover", "old_revoke_requested", "complete"} \
            and not replacement_verified:
        raise ValueError("Rotation cannot cut over before replacement proof")
    if state == "complete" and upstream_status == "unknown": state = "incomplete"
    body = {"receipt_id": f"orr_{digest({'plan': plan.plan_hash, 'state': state})[:48]}",
        "plan_hash": plan.plan_hash, "state": state, "predecessor_hash": predecessor_hash,
        "local_status": "disabled" if state in {"old_revoke_requested", "complete", "incomplete"} else "active",
        "upstream_status": upstream_status,
        "reason": "upstream_unknown" if upstream_status == "unknown" and state == "incomplete" else "completed",
        "occurred_at": now}
    return with_hash(RotationReceipt, "receipt_hash", **body)


def recover(request: RecoveryRequest, class_id: str, now: datetime) -> RecoveryReceipt:
    outcome, reason = evaluate_recovery(request, class_id)
    body = {"receipt_id": f"orv_{digest({'request': request.request_hash})[:48]}",
        "request_hash": request.request_hash, "outcome": outcome,
        "local_status": "active" if outcome != "blocked" else "disabled",
        "upstream_status": "unknown", "reason": reason, "occurred_at": now}
    return with_hash(RecoveryReceipt, "receipt_hash", **body)


def revoke(descriptor: OperationalSecretDescriptor, now: datetime,
           provider_reported: bool = False) -> RevocationReceipt:
    body = {"receipt_id": f"orx_{digest({'descriptor': descriptor.descriptor_hash, 'at': now})[:48]}",
        "descriptor_id": descriptor.descriptor_id,
        "upstream_status": "provider_reported" if provider_reported else "unknown",
        "reason": "completed" if provider_reported else "upstream_unknown", "occurred_at": now}
    return with_hash(RevocationReceipt, "receipt_hash", **body)


def simulate_destruction(plan: DestructionPlan, now: datetime, *, complete_inventory: bool,
                         active_envelopes: bool, unresolved_lifecycle: bool) -> DestructionReceipt:
    blocked = not complete_inventory or active_envelopes or unresolved_lifecycle
    body = {"receipt_id": f"odr_{digest({'plan': plan.plan_hash})[:48]}",
        "plan_hash": plan.plan_hash, "outcome": "blocked" if blocked else "simulated_local",
        "reason": "inventory_incomplete" if blocked else "simulated_local", "occurred_at": now}
    return with_hash(DestructionReceipt, "receipt_hash", **body)


def assess_readiness(*, seed: str, tenant_scope: str, dependency_hashes: list[str],
                     inventory_hash: str, receipt_chain_hash: str, blockers: list[str],
                     now: datetime) -> CustodyReadinessAssessment:
    reasons = blockers or ["ready", "product_unavailable"]
    body = {"assessment_id": f"oca_{digest({'seed': seed, 'tenant': tenant_scope})[:48]}",
        "tenant_scope": tenant_scope, "registry_hash": registry_hash(),
        "dependency_hashes": sorted(dependency_hashes), "inventory_hash": inventory_hash,
        "receipt_chain_hash": receipt_chain_hash,
        "local_fixture_outcome": "blocked" if blockers else "ready",
        "product_outcome": "unavailable", "reasons": reasons, "assessed_at": now}
    return with_hash(CustodyReadinessAssessment, "assessment_hash", **body)
