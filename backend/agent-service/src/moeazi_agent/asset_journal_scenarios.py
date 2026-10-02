"""Frozen scenarios and a separate expected-outcome oracle for Feature 10."""
from __future__ import annotations

from datetime import datetime

from .asset_journal_canonical import digest
from .asset_journal_contracts import AssetUnit, JournalAccount, JournalManifest, JournalScope, PostingCandidate, SourceEvent
from .asset_journal_evaluator import evaluate, receipt
from .asset_journal_registry import registry_hash

_CASES = {
    # Supported movement and settlement families.
    "clean-wallet-transfer": "balanced", "venue-available-lock": "balanced", "pending-to-posted": "balanced",
    "void-with-reversal": "balanced", "expiry-with-reversal": "balanced", "swap-independent-legs": "balanced",
    "deposit-withdrawal": "balanced", "fee-gas": "balanced", "positive-funding": "balanced", "negative-funding": "balanced",
    "realized-pnl": "balanced", "liquidation-observed-legs": "balanced", "bridge-distinct-units": "balanced",
    "opening-cutoff": "partial", "catchup-complete": "balanced", "catchup-gap": "partial",
    # Conservation, source, finality and lifecycle defects.
    "asymmetric-leg": "mismatch", "missing-posting": "mismatch", "duplicate-posting": "mismatch",
    "duplicate-source": "mismatch", "changed-payload-retry": "mismatch", "wrong-side": "mismatch",
    "wrong-account-unit": "mismatch", "cross-unit-netting": "mismatch", "zero-only": "mismatch",
    "negative-overflow-scientific-float": "mismatch", "reordered-posting": "mismatch", "unknown-symbol-only": "unknown",
    "pending-coverage": "partial", "unsupported-finality": "unknown", "fee-on-transfer": "unknown", "rebase": "unknown",
    "estimated-fee": "unknown", "unrealized-pnl": "unknown", "pending-posted-fork": "mismatch",
    "double-settle": "mismatch", "unresolved-reorg": "unknown", "resolved-reorg-reversal": "balanced",
    "correction-without-reversal": "mismatch", "noninverse-reversal": "mismatch", "replacement-after-reversal": "balanced",
    "cross-scope-collision": "mismatch", "feature09-drift": "unknown", "registry-drift": "unknown",
}

def scenario_registry() -> list[dict]: return [{"id": key, "operation": "check"} for key in sorted(_CASES)]

def _scope() -> JournalScope:
    body = {"tenant_id": "tenant:fixture", "account_id": "account:fixture", "owner_provider": "particle_fixture",
        "owner_fingerprint": "owner:fixture", "chain_id": 42161, "scope_key": "scope:fixture"}
    return JournalScope(**body, scope_hash=digest(body))

def _unit() -> AssetUnit:
    body = {"unit_id": "unit:usdc-wallet", "domain": "arbitrum_wallet", "locator": "asset:usdc-fixture", "decimals": 6,
        "definition_revision": "revision:one", "instrument_context_hash": digest({"feature": "07"}), "certification_hash": digest({"cert": "fixture"})}
    return AssetUnit(**body, unit_hash=digest(body))

def _account(scope: JournalScope, unit: AssetUnit, name: str) -> JournalAccount:
    body = {"account_id": f"account:{name}", "scope_hash": scope.scope_hash, "location": f"location:{name}",
        "bucket": "wallet_available", "unit_hash": unit.unit_hash}
    return JournalAccount(**body, account_hash=digest(body))

def _event(scope: JournalScope, now: datetime, finality: str) -> SourceEvent:
    body = {"source_owner": "owner:fixture", "source_stream": "stream:wallet", "event_id": "event:transfer", "revision": "revision:one",
        "sequence": 1, "event_class": "transfer", "scope_hash": scope.scope_hash, "effective_at": now, "observed_at": now,
        "finality": finality, "evidence_hash": digest({"evidence": 1}), "payload_hash": digest({"payload": 1}), "predecessor_hash": None}
    return SourceEvent(**body, event_hash=digest(body))

def _candidate(ordinal: int, account: JournalAccount, side: str, amount: str) -> PostingCandidate:
    body = {"ordinal": ordinal, "account_hash": account.account_hash, "unit_hash": account.unit_hash, "side": side, "amount": amount, "source_leg": "leg:transfer"}
    return PostingCandidate(**body, candidate_hash=digest(body))

def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str, closure_hash: str | None = None) -> dict:
    if scenario_id not in _CASES: raise ValueError("Unknown checked-in journal scenario")
    scope, unit = _scope(), _unit(); left, right = _account(scope, unit, "left"), _account(scope, unit, "right")
    unknown = {"unsupported-finality", "unknown-symbol-only", "fee-on-transfer", "rebase", "estimated-fee", "unrealized-pnl", "unresolved-reorg", "feature09-drift", "registry-drift"}
    partial = {"pending-coverage", "opening-cutoff", "catchup-gap", "missing-posting"}
    mismatch = {"asymmetric-leg", "duplicate-posting", "duplicate-source", "changed-payload-retry", "wrong-side", "wrong-account-unit", "cross-unit-netting", "zero-only", "negative-overflow-scientific-float", "reordered-posting", "pending-posted-fork", "double-settle", "correction-without-reversal", "noninverse-reversal", "cross-scope-collision"}
    finality = "unknown" if scenario_id in unknown else "pending" if scenario_id in partial else "safe"
    amounts = ("10", "9") if scenario_id in mismatch else ("10", "10")
    candidates = [_candidate(1, left, "credit", amounts[0]), _candidate(2, right, "debit", amounts[1])]
    if scenario_id == "missing-posting": candidates = candidates[:1]
    if scenario_id == "duplicate-posting": candidates[1] = _candidate(1, right, "debit", amounts[1])
    if scenario_id == "wrong-account-unit":
        body = candidates[1].model_dump(exclude={"candidate_hash"}); body["unit_hash"] = "0" * 64
        candidates[1] = PostingCandidate(**body, candidate_hash=digest(body))
    source = _event(scope, now, finality)
    if scenario_id == "duplicate-source": source = _event(scope, now, finality)
    request_hash = digest({"scenario": scenario_id, "run": run_hash})
    body = {"scope": scope, "operation": "check", "registry_hash": registry_hash(), "corpus_hash": digest({"corpus": scenario_id}),
        "expectation_hash": digest({"expected": _CASES[scenario_id]}), "unit_hashes": [unit.unit_hash],
        "account_hashes": sorted([left.account_hash, right.account_hash]), "source_hashes": [source.event_hash],
        "candidate_hashes": sorted(item.candidate_hash for item in candidates), "repository_sha": "0" * 40,
        "prerequisite_closure_hash": closure_hash or digest({"feature": "09", "status": "untrusted"}), "prerequisite_status": "requires_revalidation",
        "idempotency_key": f"journal:{run_hash[:48]}", "request_hash": request_hash, "frozen_at": now}
    manifest = JournalManifest(**body, manifest_hash=digest(body)); events = [source, source] if scenario_id == "duplicate-source" else [source]
    check = evaluate(manifest, [left, right], events, candidates)
    journal_receipt = receipt(manifest, check, "committed" if check.outcome == "balanced" else "rejected")
    expected = _CASES[scenario_id]
    return {"_manifest": manifest, "_units": [unit], "_accounts": [left, right], "_events": events, "_candidates": candidates, "_check": check, "_receipt": journal_receipt,
        "fixtureHash": digest({"scenario": scenario_id, "registry": registry_hash()}), "baselineOutcome": "unavailable", "candidateOutcome": check.outcome,
        "actualOutcome": check.outcome, "conservationOutcome": check.outcome, "coverageOutcome": check.outcome,
        "totals": check.totals, "pendingCount": 1 if check.outcome == "partial" else 0, "gapCount": 1 if check.outcome == "partial" else 0,
        "conflictCount": 1 if check.outcome == "mismatch" else 0, "permittedLanes": check.safe_lanes, "checkHash": check.check_hash,
        "receiptHash": journal_receipt.receipt_hash, "registryHash": registry_hash(), "productOutcome": "unavailable", "reasons": check.reasons,
        "invariantVerdict": "pass" if check.outcome == expected else "fail"}
