from moeazi_agent.risk_tiered_consent_fixture_executor import FixtureConsentExecutor


def test_double_click_and_race_labels_require_terminal_handler_outcomes():
    double = FixtureConsentExecutor()
    assert double.consume("accepted") == "accepted"
    assert double.consume("accepted") == "rejected"
    label, _ = double.evidence(None, "issued")
    assert label == "double_click_winner"

    race = FixtureConsentExecutor()
    assert race.consume("accepted") == "accepted"
    assert race.consume("declined") == "rejected"
    label, _ = race.evidence(None, "issued")
    assert label == "race_single_winner"


def test_conflict_and_rollback_labels_require_executed_claim_and_transaction():
    executor = FixtureConsentExecutor()
    assert executor.claim("key", "first") == "created"
    assert executor.claim("key", "second") == "conflict"
    assert executor.evidence(None, "issued")[0] == "idempotency_conflict"

    rollback = FixtureConsentExecutor()
    assert rollback.persist(("packet",), fail=True) == "rolled_back"
    assert rollback.persisted == []
    assert rollback.evidence(None, "issued")[0] == "storage_rollback"


def test_missing_handlers_cannot_claim_a_scenario_label():
    executor = FixtureConsentExecutor()
    try:
        executor.evidence(None, "issued")
    except AssertionError as error:
        assert str(error) == "scenario_did_not_execute_a_mutation"
    else:
        raise AssertionError("missing mutation handler was accepted")
