from datetime import datetime, timezone

from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.scheduled_analysis import managed_admission_payload


def test_managed_schedule_admission_uses_registered_lifecycle_fields():
    binding = {"assignmentId": "assignment-1", "programVersionId": "version-1",
               "marketId": "WETH-USDC", "scheduleRevision": 123,
               "controllerRef": {"contentHash": "a" * 64}}
    payload = managed_admission_payload(binding, "account-1")
    decision, admitted, receipts, _ = evaluate_persistence(
        producer="analysis_admission", purpose="agent_analysis",
        sink="temporal.analysis_payload",
        scope=LifecycleScope(kind="account", key="account:account-1",
                             strategy_account_id="account-1"),
        payload=payload, artifact_id="schedule:assignment-1:version-1:WETH-USDC:123",
        idempotency_key="admission:managed:assignment-1:123",
        observed_at=datetime(2026, 10, 3, tzinfo=timezone.utc))
    assert decision.outcome in {"allow", "transformed"}
    assert admitted["profile_id"] == "assignment-1"
    assert receipts
    assert "controller_ref" not in admitted
