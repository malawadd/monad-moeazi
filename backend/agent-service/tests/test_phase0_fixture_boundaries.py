"""Package-5 local boundary regressions; these do not contact a service."""
from datetime import datetime, timezone
from pathlib import Path

from moeazi_agent.risk_reconciliation_scenarios import evaluate_fixture


def test_frozen_prerequisite_changes_manifest_not_fixture_authority():
    now = datetime(2026, 8, 14, tzinfo=timezone.utc)
    first = evaluate_fixture("complete-fresh-snapshot", "observe", now, "operator", "a" * 64, "b" * 64)
    second = evaluate_fixture("complete-fresh-snapshot", "observe", now, "operator", "a" * 64, "c" * 64)
    assert first["_manifest"].prerequisite_closure_hash != second["_manifest"].prerequisite_closure_hash
    assert first["_manifest"].manifest_hash != second["_manifest"].manifest_hash
    assert first["productOutcome"] == second["productOutcome"] == "unavailable"


def test_phase0_evaluator_modules_have_no_network_or_authority_adapter_imports():
    root = Path(__file__).parents[1] / "src" / "moeazi_agent"
    modules = ("temporal_integrity_evaluator.py", "instrument_lifecycle_evaluator.py",
               "capability_delegation_evaluator.py", "risk_reconciliation_evaluator.py")
    prohibited = ("requests", "httpx", "websocket", "socket", "subprocess", "signer", "wallet")
    for name in modules:
        body = (root / name).read_text(encoding="utf-8").lower()
        assert not any(f"import {word}" in body or f"from {word}" in body for word in prohibited)
