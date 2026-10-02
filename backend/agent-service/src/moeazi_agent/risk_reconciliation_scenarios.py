"""Independent synthetic corpus. Expected outcome is checked separately from evaluation."""
from __future__ import annotations

from datetime import datetime, timedelta

from .risk_reconciliation_canonical import digest
from .risk_reconciliation_contracts import (ExecutionAttemptReceipt, ReconciliationReceipt,
    RiskObservation, RiskScope)
from .risk_reconciliation_evaluator import evaluate_snapshot, frozen_manifest, reservation_from_snapshot
from .risk_reconciliation_registry import registry_hash

_CASES = {"complete-fresh-snapshot": ("available", 10, "complete"), "explicit-zero-is-authoritative": ("available", 0, "complete"),
    "missing-source-block": ("missing", 10, "missing"), "stale-source-block": ("stale", 10, "stale"),
    "disputed-source-block": ("disputed", 10, "disputed"), "one-unit-over-holds": ("available", 101, "conflict"),
    "possible-submission-holds": ("available", 10, "reconciliation_hold"), "reorg-holds": ("available", 10, "reconciliation_hold")}


def scenario_registry() -> list[dict]: return [{"id": key, "operation": "reconcile" if "hold" in key else "reserve"} for key in sorted(_CASES)]


def scope() -> RiskScope:
    return RiskScope(tenant_id="tenant:fixture", account_id="account:fixture", owner_provider="particle_fixture",
        owner_fingerprint="owner:particle-fixture", chain_id=42161, venue="fixture_venue", instrument_fingerprint="instrument:eth",
        market_fingerprint="market:eth-usdc", scope_key="scope:fixture")


def _observation(source: str, now: datetime, status: str, capacity: int) -> RiskObservation:
    values = ({"capacity": capacity} if source == "portfolio" else {"source_value": 0}) if status == "available" else {}
    body = {"source_id": source, "scope": scope(), "owner_kind": f"owner:{source}", "revision": f"revision:{source}",
        "observed_at": now, "expires_at": now + timedelta(minutes=1), "status": status,
        "evidence_hash": digest({"source": source, "revision": 1}), "values": values}
    return RiskObservation(**body, observation_hash=digest(body))


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str, closure_hash: str | None = None) -> dict:
    if scenario_id not in _CASES: raise ValueError("Unknown checked-in risk scenario")
    status, delta, expected = _CASES[scenario_id]
    observations = [_observation(source, now, status if source == "portfolio" else "available", 100) for source in ["analysis", "credit", "portfolio", "product", "quote", "reconciliation"]]
    if status == "stale":
        body = observations[2].model_dump(exclude={"observation_hash"}); body["observed_at"] = now - timedelta(minutes=2); body["expires_at"] = now - timedelta(seconds=1)
        observations[2] = RiskObservation(**body, observation_hash=digest(body))
    manifest = frozen_manifest(scope(), "reserve", observations, now, f"risk:{run_hash[:48]}", digest({"scenario": scenario_id, "registry": registry_hash()}), closure_hash or digest({"closure": "fixture"}))
    snapshot = evaluate_snapshot(scope(), observations, manifest, now)
    reservation = reservation_from_snapshot(snapshot, manifest, {"volume": delta}, now)
    terminal = expected if expected in {"complete", "missing", "stale", "disputed"} else reservation.state
    attempt = None; reconciliation = None
    if scenario_id in {"possible-submission-holds", "reorg-holds"}:
        attempt_body = {"attempt_id": f"attempt:{run_hash[:32]}", "snapshot_hash": snapshot.snapshot_hash, "reservation_hash": reservation.reservation_hash,
            "quote_hash": manifest.quote_hash, "action_summary_hash": digest({"action": "fixture"}), "state": "possible_submission",
            "prepared_payload_hash": digest({"prepared": "identity"}), "observed_at": now, "error_code": None}
        attempt = ExecutionAttemptReceipt(**attempt_body, receipt_hash=digest(attempt_body))
        recon_body = {"attempt_hash": attempt.receipt_hash, "snapshot_hash": snapshot.snapshot_hash, "reservation_hash": reservation.reservation_hash,
            "expected_state_hash": digest({"expected": 1}), "observed_state_hash": digest({"observed": 2}),
            "outcome": "reorged" if scenario_id == "reorg-holds" else "unresolved", "reservation_disposition": "reconciliation_hold",
            "watermark": 1, "comparison_hash": digest({"comparison": "fixture"})}
        reconciliation = ReconciliationReceipt(**recon_body, receipt_hash=digest(recon_body)); terminal = reconciliation.reservation_disposition
    return {"_manifest": manifest, "_observations": observations, "_snapshot": snapshot, "_reservation": reservation,
        "_attempt": attempt, "_reconciliation": reconciliation, "fixtureHash": digest({"scenario": scenario_id, "registry": registry_hash()}),
        "baselineOutcome": "unavailable", "candidateOutcome": terminal, "actualOutcome": terminal, "snapshotOutcome": snapshot.outcome,
        "sourceCompleteness": len([x for x in observations if x.status == "available"]), "utilization": sum(reservation.deltas.values()),
        "reservationState": reconciliation.reservation_disposition if reconciliation else reservation.state,
        "attemptState": attempt.state if attempt else "not_started", "reconciliationOutcome": reconciliation.outcome if reconciliation else "not_started",
        "permittedLanes": snapshot.safe_lanes, "snapshotHash": snapshot.snapshot_hash, "reservationHash": reservation.reservation_hash,
        "registryHash": registry_hash(), "productOutcome": "unavailable", "reasons": [] if snapshot.outcome == "complete" else [f"observation_{snapshot.outcome}"],
        "invariantVerdict": "pass" if terminal == expected else "fail"}
