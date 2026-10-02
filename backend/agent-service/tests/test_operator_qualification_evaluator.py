from datetime import datetime, timezone

from moeazi_agent.operator_qualification_scenarios import evaluate_fixture, scenario_registry


NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def run(scenario):
    return evaluate_fixture(scenario, "observe", NOW, "operator:test", "a" * 64)


def test_passing_fixture_stays_non_authoritative():
    result = run("qualification-pass-independent-review")
    assert result["fixtureQualificationStatus"] == "active_fixture"
    assert result["productQualificationStatus"] == "unknown"
    assert result["productOutcome"] == "unavailable"
    assert result["authorityEffect"] == "none"
    assert result["externalAttempts"] == result["providerCost"] == 0


def test_hard_failures_and_review_aliases_do_not_grant():
    for scenario in ("qualification-hard-step-failure", "qualification-self-review",
                     "qualification-alias-review", "qualification-copy-attempt"):
        assert run(scenario)["actualOutcome"] == "blocked"


def test_expiry_and_revocation_block_consumption():
    for scenario in ("qualification-expired-grant", "qualification-revoked-consumption"):
        result = run(scenario)
        assert result["consumptionStatus"] == "blocked"
        assert result["productQualificationStatus"] == "unknown"


def test_corpus_is_closed_and_replayable():
    ids = [item["id"] for item in scenario_registry()]
    assert len(ids) == len(set(ids)) >= 25
    assert run(ids[0]) == run(ids[0])
