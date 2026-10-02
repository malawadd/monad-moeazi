"""Pure exact-match evaluator for checked-in, untrusted fixture packs."""
from __future__ import annotations
from datetime import timedelta
from .usage_rights_canonical import digest
from .usage_rights_decision_contracts import UsageLeafMatch, UsageOperationRequest, UsageRightsDecision
from .usage_rights_registry import limit
from .usage_rights_rulepack_contracts import UsageRightsRulepack


def _usable(pack: UsageRightsRulepack, request: UsageOperationRequest, now) -> bool:
    return pack.scope.scope_hash == request.scope.scope_hash and pack.effective_at <= now < pack.expires_at and pack.registry_hash and request.feature03_context is not None


def validate_contiguous_chain(items, identity, revision, predecessor):
    """Reject forks, gaps and predecessor rewrites before selecting a head."""
    rows = sorted(items, key=revision)
    if not rows: return False
    if [revision(row) for row in rows] != list(range(1, len(rows) + 1)): return False
    if len({identity(row) for row in rows}) != len(rows): return False
    return all(predecessor(row) == (None if revision(row) == 1 else identity(rows[index - 1]))
               for index, row in enumerate(rows))


def resolve_active_rulepack(packs, activations, now):
    """Return only a contiguous, activated, non-expired head; otherwise ``None``."""
    if not validate_contiguous_chain(packs, lambda row: row.rulepack_hash,
                                    lambda row: row.revision,
                                    lambda row: row.predecessor_hash): return None
    if not validate_contiguous_chain(activations, lambda row: row.activation_hash,
                                    lambda row: row.sequence,
                                    lambda row: row.predecessor_hash): return None
    head = activations[-1]
    if head.rulepack_hash is None: return None
    pack = next((item for item in packs if item.rulepack_hash == head.rulepack_hash), None)
    return pack if pack and pack.effective_at <= now < pack.expires_at else None


def resolve_verified_rulepack(packs, sources, attestations, manifest, golden_receipts,
                            activations, scope_hash, now):
    """Resolve only a contiguous head with current sources and fresh passing goldens."""
    pack = resolve_active_rulepack(packs, activations, now)
    if not pack or pack.scope.scope_hash != scope_hash:
        return None
    chains = {}
    for source in sources: chains.setdefault(source.source_id, []).append(source)
    if not chains or any(not validate_contiguous_chain(rows, lambda row: row.source_hash,
            lambda row: row.revision, lambda row: row.predecessor_hash) for rows in chains.values()): return None
    source_by_hash = {rows[-1].source_hash: rows[-1] for rows in chains.values()}
    if set(pack.source_hashes) != set(source_by_hash) or any(
            row.status != "current" or not (row.effective_at <= now < row.expires_at)
            for row in source_by_hash.values()): return None
    if set(pack.attestation_hashes) != {row.attestation_hash for row in attestations}:
        return None
    if any(not (row.effective_at <= now < row.expires_at) for row in attestations): return None
    if not manifest or manifest.manifest_hash != pack.golden_manifest_hash or manifest.scope_hash != scope_hash:
        return None
    receipts = {row.receipt_hash: row for row in golden_receipts}
    if set(manifest.case_receipt_hashes) != set(receipts): return None
    if any(not row.passed or row.manifest_hash != manifest.manifest_hash or not (row.evaluated_at <= now < row.expires_at) for row in receipts.values()):
        return None
    return pack


def evaluate(pack: UsageRightsRulepack | None, request: UsageOperationRequest, now) -> UsageRightsDecision:
    if pack is None or not _usable(pack, request, now):
        matches = tuple(UsageLeafMatch(leaf_id=leaf.leaf_id, disposition="unknown", reason_code="PACK_INACTIVE") for leaf in request.subject.leaves)
        return _decision(request, None, matches, (), now)
    matches = []
    for leaf in request.subject.leaves:
        candidates = [item for item in pack.assertions if item.subject_class == leaf.subject_class and item.subject_revision == leaf.revision and item.operation == request.operation and item.purpose == request.purpose and item.destination_class == request.destination_class and item.recipient_class == request.recipient_class and item.commercial == request.commercial and item.adaptation == request.adaptation and request.retention_seconds <= item.max_retention_seconds and request.quantity <= item.max_quantity]
        if len(candidates) != 1:
            matches.append(UsageLeafMatch(leaf_id=leaf.leaf_id, disposition="unknown" if not candidates else "manual_legal_review_required", reason_code="ASSERTION_MISSING" if not candidates else "LINEAGE_INVALID"))
        else:
            item = candidates[0]; matches.append(UsageLeafMatch(leaf_id=leaf.leaf_id, assertion_hash=item.assertion_hash, disposition=item.disposition, reason_code="MATCHED"))
    required = tuple(sorted({name for item in pack.assertions for name in item.obligations if any(match.assertion_hash == item.assertion_hash for match in matches)}))
    return _decision(request, pack.rulepack_hash, tuple(matches), required, now, pack.expires_at)


def _decision(request, pack_hash, matches, required, now, pack_expiry=None):
    rank = {"allow": 0, "unknown": 1, "manual_legal_review_required": 2, "deny": 3}
    disposition = max((item.disposition for item in matches), key=lambda item: rank[item])
    expires = min(now + timedelta(seconds=limit("decisionTtlSeconds")), pack_expiry or now + timedelta(seconds=limit("decisionTtlSeconds")))
    body = {"request_hash": request.request_hash, "rulepack_hash": pack_hash, "disposition": disposition,
            "fixture_disposition": "block" if disposition != "allow" else "permit_fixture" if not required else "pending_obligations", "leaf_matches": matches,
            "required_obligations": required if disposition == "allow" else (), "fulfilled_obligations": (), "expires_at": expires,
            "predecessor_decision_hash": None, "fixture_only": True, "accepted_for_product": False,
            "operation_performed": False, "product_outcome": "unavailable", "authority_effect": "none",
            "external_attempts": 0, "provider_cost": 0}
    return UsageRightsDecision(**body, decision_hash=digest(body))


def close_obligations(decision: UsageRightsDecision, receipts, now) -> UsageRightsDecision:
    if decision.disposition != "allow" or now >= decision.expires_at: return decision
    matching = [row for row in receipts if row.decision_hash == decision.decision_hash]
    duplicate = len({row.obligation for row in matching}) != len(matching)
    valid = {row.obligation for row in matching if row.status == "fulfilled" and row.fulfilled_at < decision.expires_at}
    if duplicate: valid = set()
    fulfilled = tuple(sorted(set(decision.required_obligations) & valid))
    body = decision.model_dump(exclude={"decision_hash", "fulfilled_obligations", "predecessor_decision_hash", "fixture_disposition"}, mode="python")
    body.update({"fulfilled_obligations": fulfilled, "predecessor_decision_hash": decision.decision_hash,
                 "fixture_disposition": "permit_fixture" if set(decision.required_obligations) <= set(fulfilled) else "pending_obligations"})
    return UsageRightsDecision(**body, decision_hash=digest(body))
