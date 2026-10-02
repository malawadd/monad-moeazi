from datetime import datetime,timezone
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture,scenario_registry,expectations
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def test_registered_scenarios_exercise_declared_mutation():
    rows=scenario_registry(); expected=expectations()
    assert set(expected)=={row["id"] for row in rows}
    required={"tier","issuance","ceremony","lifecycle","nonceState","comparisonOutcome","invalidationOutcome","reasonCodes","mutationObserved","storageGraph","nonAuthorizing","authorityEffect","dispatchAvailable","externalAttempts","providerCost"}
    for row in rows:
        value=evaluate_fixture(row["id"],"enforce",NOW,"operator",("a"*63)+str(len(row["id"])%10))
        events=value["mutationEvidence"]["events"]
        assert row["mutation"] != "double_click" or ("consume:accepted:accepted" in events and "consume:accepted:rejected" in events)
        assert row["mutation"] != "race" or ("consume:accepted:accepted" in events and "consume:declined:rejected" in events)
        assert row["mutation"] != "conflict" or "claim:conflict" in events
        assert row["mutation"] != "storage_failpoint" or ("storage:rollback" in events and value["storageGraph"]=="rolled_back")
        assert set(expected[row["id"]])==required
        assert {key:value[key] for key in required}==expected[row["id"]]
        assert value["externalAttempts"]==0 and value["providerCost"]==0
