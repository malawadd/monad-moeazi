from datetime import datetime, timezone
import pytest
from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence

NOW=datetime(2026,9,8,tzinfo=timezone.utc)
def test_scope_is_canonical_before_lifecycle_evaluation():
    scope=LifecycleScope(kind="account",key="account:fixture",strategy_account_id="fixture")
    decision,_,_,_=evaluate_persistence(producer="push_evidence",purpose="market_observation",sink="timescale.evidence",scope=scope,payload={"market":"BTC","source":"fixture","observed_at":"2026-09-08T00:00:00Z","price":"1"},idempotency_key="remediation:elc",observed_at=NOW)
    assert decision.scope.key == scope.key
    with pytest.raises(ValueError): LifecycleScope(kind="account",key="account:fixture:bad",strategy_account_id="fixture:bad")
