"""Pure per-unit conservation checker for frozen local journal candidates."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from .asset_journal_canonical import digest, exact_amount
from .asset_journal_contracts import ConservationCheck, JournalAccount, JournalManifest, PostingCandidate, SourceEvent
from .asset_journal_registry import raw

PRECEDENCE = {"balanced": 0, "partial": 1, "unknown": 2, "mismatch": 3}


def evaluate(manifest: JournalManifest, accounts: list[JournalAccount], events: list[SourceEvent],
             candidates: list[PostingCandidate]) -> ConservationCheck:
    reasons: set[str] = set(); totals: dict[str, dict[str, int]] = defaultdict(lambda: {"debit": 0, "credit": 0})
    account_map = {item.account_hash: item for item in accounts}
    if len(account_map) != len(accounts): reasons.add("duplicate_account")
    if sorted(item.candidate_hash for item in candidates) != manifest.candidate_hashes: reasons.add("candidate_closure_mismatch")
    if [item.event_hash for item in events] != manifest.source_hashes: reasons.add("source_closure_mismatch")
    if {item.account_hash for item in accounts} != set(manifest.account_hashes): reasons.add("account_closure_mismatch")
    for event in events:
        if event.scope_hash != manifest.scope.scope_hash: reasons.add("scope_mismatch")
        if event.event_class not in raw()["eventClasses"]: reasons.add("unregistered_event")
        if event.finality in {"disputed", "unknown", "reorged"}: reasons.add("invalid_finality")
        elif event.finality == "pending": reasons.add("pending_finality")
    seen = set()
    for candidate in candidates:
        account = account_map.get(candidate.account_hash)
        if not account or account.unit_hash != candidate.unit_hash: reasons.add("account_unit_mismatch"); continue
        if candidate.ordinal in seen: reasons.add("duplicate_posting")
        seen.add(candidate.ordinal)
        totals[candidate.unit_hash][candidate.side] += exact_amount(candidate.amount)
    if not candidates or not any(item.side == "debit" for item in candidates) or not any(item.side == "credit" for item in candidates): reasons.add("missing_companion_leg")
    for unit, values in totals.items():
        if not values["debit"] or not values["credit"] or values["debit"] != values["credit"]: reasons.add("unit_delta_mismatch")
    outcome = "balanced"
    if any(code in reasons for code in {"account_unit_mismatch", "candidate_closure_mismatch", "source_closure_mismatch", "duplicate_account", "duplicate_posting", "unit_delta_mismatch"}): outcome = "mismatch"
    elif any(code in reasons for code in {"invalid_finality", "unregistered_event"}): outcome = "unknown"
    elif reasons: outcome = "partial"
    rendered = {unit: {"debit": str(value["debit"]), "credit": str(value["credit"]), "delta": str(value["debit"] - value["credit"])}
        for unit, value in sorted(totals.items())}
    safe = raw()["safeLanes"] if outcome != "balanced" else ["reconcile", "settle_existing"]
    body = {"outcome": outcome, "totals": rendered, "reasons": sorted(reasons), "safe_lanes": safe}
    return ConservationCheck(**body, check_hash=digest(body))


def receipt(manifest: JournalManifest, check: ConservationCheck, outcome: str = "committed", transaction_hash: str | None = None):
    from .asset_journal_contracts import JournalReceipt
    body = {"receipt_id": f"receipt:{manifest.request_hash[:32]}", "scope_hash": manifest.scope.scope_hash,
        "idempotency_key": manifest.idempotency_key, "request_hash": manifest.request_hash, "manifest_hash": manifest.manifest_hash,
        "check_hash": check.check_hash, "transaction_hash": transaction_hash, "outcome": outcome, "predecessor_hash": None}
    return JournalReceipt(**body, receipt_hash=digest(body))
