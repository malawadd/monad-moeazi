"""Negative controls for the checked-in Phase 0 fixture corpora."""
from datetime import datetime, timezone

from moeazi_agent.instrument_lifecycle_scenarios import evaluate_fixture as instrument
from moeazi_agent.temporal_integrity_scenarios import evaluate_fixture as temporal


NOW = datetime(2026, 8, 11, tzinfo=timezone.utc)


def test_temporal_restart_and_reorg_controls_change_real_candidate_outcomes(monkeypatch):
    import moeazi_agent.temporal_integrity_scenarios as scenarios
    baseline = temporal("temporal-interior-allow", "observe", NOW, "operator", "a" * 64)
    assert baseline["actualOutcome"] == "allow"
    monkeypatch.setitem(scenarios._CASES, "temporal-interior-allow", ("prepare", "restart"))
    restarted = temporal("temporal-interior-allow", "observe", NOW, "operator", "a" * 64)
    assert restarted["actualOutcome"] == "block" and restarted["invariantVerdict"] == "fail"


def test_temporal_nonce_conflict_is_not_an_expectation_only_verdict():
    result = temporal("temporal-nonce-conflict-block", "enforce", NOW, "operator", "b" * 64)
    assert result["actualOutcome"] == "block"
    assert "nonce_lease_missing" in result["reasons"]


def test_instrument_event_and_scope_negative_controls_change_candidate_outcome(monkeypatch):
    import moeazi_agent.instrument_lifecycle_scenarios as scenarios
    baseline = instrument("exact-native-active-allow", "observe", NOW, "operator", "c" * 64)
    assert baseline["actualOutcome"] == "allow"
    monkeypatch.setitem(scenarios._CASES, "exact-native-active-allow", ("propose", "conflict"))
    conflict = instrument("exact-native-active-allow", "observe", NOW, "operator", "c" * 64)
    assert conflict["actualOutcome"] == "block" and conflict["invariantVerdict"] == "fail"
    scoped = instrument("cross-tenant-alias-block", "enforce", NOW, "operator", "d" * 64)
    assert scoped["actualOutcome"] == "block"
