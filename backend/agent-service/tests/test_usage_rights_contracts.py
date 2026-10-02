from datetime import datetime, timezone
from moeazi_agent.usage_rights_scenarios import _context, _pack, _scope, _subject, evaluate_fixture, scenario_registry
from moeazi_agent.usage_rights_canonical import digest
from moeazi_agent.usage_rights_decision_contracts import UsageOperationRequest
from moeazi_agent.usage_rights_evaluator import evaluate


def test_all_checked_in_operations_are_exact_fixture_results():
    now = datetime(2026, 9, 7, tzinfo=timezone.utc)
    results = [evaluate_fixture(row["id"], "observe", now, "operator:fixture", "a" * 64)
               for row in scenario_registry()]
    assert len(results) >= 36
    assert {item["requestedOperation"] for item in results} == {item["operation"] for item in scenario_registry()}
    assert all(item["fixtureOnly"] and not item["operationPerformed"] for item in results)
    assert all(item["productOutcome"] == "unavailable" and item["externalAttempts"] == 0 for item in results)


def test_all_144_cross_operation_reuse_attempts_block():
    now = datetime(2026, 9, 7, tzinfo=timezone.utc); scope = _scope(); subject = _subject(scope); context = _context(scope)
    for source in (row["operation"] for row in scenario_registry()):
        for target in (row["operation"] for row in scenario_registry()):
            body = {"scope": scope, "subject": subject, "operation": target, "purpose": "fixture_test", "destination_class": "local_test", "recipient_class": "fixture_user", "commercial": False, "adaptation": False, "retention_seconds": 0, "quantity": 1, "requested_at": now, "feature03_context": context, "idempotency_hash": digest({"source": source, "target": target})}
            request = UsageOperationRequest(**body, request_hash=digest(body)); result = evaluate(_pack(scope, source), request, now)
            assert result.fixture_disposition == ("permit_fixture" if source == target else "block")
