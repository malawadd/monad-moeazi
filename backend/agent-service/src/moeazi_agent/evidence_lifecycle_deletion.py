from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import Literal

from pydantic import Field, model_validator

from .dependency_safety_contracts import canonical_json
from .evidence_lifecycle_contracts import (
    CopyDispositionReceipt, DeletionReceipt, Hash, LifecycleModel, ReasonCode, ScopeKey,
)
from .evidence_lifecycle_registry import inventory_for, policy_by_hash


def digest(value) -> str:
    return sha256(canonical_json(value)).hexdigest()


class LifecycleCommand(LifecycleModel):
    command_id: str = Field(pattern=r"^elc_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    schedule_hash: Hash
    owner_id: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    copy_id: str = Field(pattern=r"^[a-z0-9_.:-]{3,96}$")
    action: Literal["expire_body", "delete_copy", "validate_restore"]
    revision: int = Field(ge=1)
    policy_hash: Hash
    reason_code: ReasonCode
    idempotency_key: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    locator: str | None = Field(default=None, max_length=180)
    issued_at: datetime
    command_hash: Hash


class LifecycleTombstone(LifecycleModel):
    tombstone_id: str = Field(pattern=r"^elt_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    copy_id: str = Field(pattern=r"^[a-z0-9_.:-]{3,96}$")
    cutoff_at: datetime
    policy_hash: Hash
    inventory_hash: Hash
    copy_receipt_hash: Hash
    body_present: Literal[False] = False
    tombstone_hash: Hash

    @model_validator(mode="after")
    def canonical_integrity(self):
        body = {"artifact_id": self.artifact_id, "scope_key": self.scope_key,
            "copy_id": self.copy_id,
            "cutoff_at": self.cutoff_at.isoformat(), "policy_hash": self.policy_hash,
            "inventory_hash": self.inventory_hash,
            "copy_receipt_hash": self.copy_receipt_hash, "body_present": False}
        expected = digest(body)
        if self.tombstone_hash != expected or self.tombstone_id != f"elt_{expected[:48]}":
            raise ValueError("Lifecycle tombstone canonical hash is invalid")
        return self


class RestoreValidation(LifecycleModel):
    validation_id: str = Field(pattern=r"^erv_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    tombstone_hash: Hash | None
    current_policy_hash: Hash
    restored_policy_hash: Hash
    inventory_hash: Hash | None
    outcome: Literal["allow", "quarantine"]
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=8)
    evaluated_at: datetime
    validation_hash: Hash


def aggregate_deletion(artifact_id: str, policy_hash: str, schedule_hash: str,
        receipts: list[CopyDispositionReceipt], now: datetime,
        scope_key: str = "public") -> DeletionReceipt:
    policy = policy_by_hash(policy_hash)
    if policy is None:
        raise ValueError("Deletion aggregation requires a registered policy hash")
    inventory = inventory_for(policy)
    expected_copies = sorted(inventory)
    latest: dict[str, CopyDispositionReceipt] = {}
    for receipt in sorted(receipts, key=lambda item: (item.copy_id, item.revision)):
        if receipt.artifact_id != artifact_id or receipt.scope_key != scope_key \
                or receipt.schedule_hash != schedule_hash \
                or receipt.copy_id not in inventory \
                or receipt.owner_id != inventory[receipt.copy_id]:
            continue
        previous = latest.get(receipt.copy_id)
        if previous:
            if receipt.revision != previous.revision + 1 or receipt.predecessor_hash != previous.receipt_hash:
                continue
        elif receipt.revision != 1 or receipt.predecessor_hash is not None:
            continue
        latest[receipt.copy_id] = receipt
    statuses = {copy_id: latest[copy_id].status if copy_id in latest else "pending"
        for copy_id in expected_copies}
    # V1 has no physical-media or key-erasure attestor.  Local callers cannot
    # turn either assertion into verified deletion.
    verified = {"verified_logical", "not_applicable"}
    for copy_id, receipt in latest.items():
        if receipt.status in {"verified_physical", "crypto_erased"}:
            statuses[copy_id] = "unverifiable"
        if receipt.owner_id in {"external_provider", "backup_owner", "public_onchain"}:
            statuses[copy_id] = "public_onchain" if receipt.owner_id == "public_onchain" else "unverifiable"
    unresolved = [status for status in statuses.values() if status not in verified]
    if not unresolved: outcome, reasons = "verified", ["allowed"]
    elif "public_onchain" in unresolved:
        outcome, reasons = "unverifiable", ["public_onchain_non_erasable"]
    elif any(status in {"unverifiable", "provider_reported"} for status in unresolved):
        outcome, reasons = "unverifiable", ["copy_unverifiable"]
    else: outcome, reasons = "partial", ["copy_pending"]
    body = {"artifact_id": artifact_id, "scope_key": scope_key,
        "schedule_hash": schedule_hash,
        "expected_copies": expected_copies,
        "policy_hash": policy.policy_hash, "inventory_hash": policy.inventory_hash,
        "copy_receipt_hashes": {key: latest[key].receipt_hash for key in sorted(latest)
            if key in expected_copies}, "outcome": outcome, "reason_codes": reasons,
        "evaluated_at": now.isoformat()}
    receipt_hash = digest(body)
    return DeletionReceipt.model_validate({**body, "receipt_id": f"edr_{receipt_hash[:48]}",
        "receipt_hash": receipt_hash})


def validate_restore(*, artifact_id: str, current_policy_hash: str,
        restored_policy_hash: str, inventory_hash: str | None,
        tombstone: LifecycleTombstone | None, scope_matches: bool,
        evaluated_at: datetime, tombstone_invalid: bool = False) -> RestoreValidation:
    reasons: list[ReasonCode] = []
    if tombstone or tombstone_invalid: reasons.append("deleted_body")
    if not scope_matches: reasons.append("scope_mismatch")
    if not inventory_hash: reasons.append("inventory_unknown")
    if restored_policy_hash != current_policy_hash: reasons.append("policy_stale")
    outcome = "quarantine" if reasons else "allow"
    body = {"artifact_id": artifact_id, "tombstone_hash": tombstone.tombstone_hash if tombstone else None,
        "current_policy_hash": current_policy_hash, "restored_policy_hash": restored_policy_hash,
        "inventory_hash": inventory_hash, "outcome": outcome,
        "reason_codes": reasons or ["allowed"], "evaluated_at": evaluated_at.isoformat()}
    validation_hash = digest(body)
    return RestoreValidation.model_validate({**body,
        "validation_id": f"erv_{validation_hash[:48]}", "validation_hash": validation_hash})
