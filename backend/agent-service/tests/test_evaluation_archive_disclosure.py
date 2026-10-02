from datetime import datetime, timedelta, timezone

from moeazi_agent.evaluation_lifecycle_disclosure import (
    admitted_archive_body, archive_content, validate_archive_row,
)
from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_identity import evaluation_owner_scope_key


NOW = datetime(2026, 8, 11, tzinfo=timezone.utc)
OWNER = "operator-a"


def _body():
    return {
        "run_id": "run-evaluation-archive", "experiment_id": "experiment-a",
        "case_id": "case-a", "subject_id": "subject-a", "analysis_id": None,
        "status": "completed", "prompt_bundle": {"version": "fixture"},
        "output": {"summary": "fixture"}, "validation": {},
        "strategy_results": [], "input_tokens": 1, "output_tokens": 2,
        "provider_cost_microusd": 3, "latency_ms": 4, "error": None,
    }


def _row(*, deleted=False, tamper=False, expired=False, account=False):
    body = _body()
    scope_key = "account:customer-account" if account else evaluation_owner_scope_key(OWNER)
    scope = (LifecycleScope(kind="account", key=scope_key,
        strategy_account_id="customer-account") if account else
        LifecycleScope(kind="tenant", key=scope_key,
            tenant_id=scope_key.removeprefix("tenant:")))
    payload = {"case_id": body["case_id"], "run_id": body["run_id"],
        "content": archive_content(body), "status": body["status"]}
    decision, _, _, schedule = evaluate_persistence(
        producer="evaluation_archive", purpose="evaluation",
        sink="timescale.analysis_body", scope=scope, payload=payload,
        artifact_id=body["run_id"], idempotency_key="evaluation-archive:run-evaluation-archive",
        observed_at=NOW)
    assert schedule
    if expired:
        schedule = schedule.model_copy(update={"body_expires_at": NOW})
    row = {**body, "created_at": NOW, "lifecycle_decision_hash": decision.decision_hash,
        "lifecycle_deleted_at": NOW if deleted else None,
        "lifecycle_admitted_body": {**body, **({"error": "forged"} if tamper else {})},
        "_lifecycle_decision": decision.model_dump(mode="json"),
        "_lifecycle_schedule": schedule.model_dump(mode="json")}
    return row


def test_archive_disclosure_returns_only_exact_hash_bound_body():
    result = validate_archive_row(_row(), OWNER, NOW + timedelta(seconds=1))
    assert result and result["output"] == {"summary": "fixture"}
    assert "lifecycle_admitted_body" not in result


def test_archive_disclosure_fails_closed_for_tamper_delete_or_expiry():
    assert validate_archive_row(_row(tamper=True), OWNER, NOW + timedelta(seconds=1)) is None
    assert validate_archive_row(_row(deleted=True), OWNER, NOW + timedelta(seconds=1)) is None
    assert validate_archive_row(_row(expired=True), OWNER, NOW) is None


def test_customer_archive_requires_exact_owned_account_scope():
    row = _row(account=True)
    assert validate_archive_row(row.copy(), OWNER, NOW + timedelta(seconds=1),
                                "account:customer-account")
    assert validate_archive_row(row.copy(), OWNER, NOW + timedelta(seconds=1)) is None
    assert validate_archive_row(row.copy(), OWNER, NOW + timedelta(seconds=1),
                                "account:another-account") is None


def test_archive_body_contract_rejects_untracked_extensions():
    body = _body()
    body["previousConsensus"] = "buy"
    assert admitted_archive_body(body)["run_id"] == "run-evaluation-archive"
