from datetime import datetime, timezone
from moeazi_agent.incident_communication_scenarios import evaluate_fixture, scenario_registry

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def test_checked_in_corpus_has_zero_authority_or_external_effects():
    for item in scenario_registry():
        result=evaluate_fixture(item["id"],"observe",NOW,"operator:fixture","a"*64)
        assert result["invariantVerdict"] == "pass"
        assert result["externalAttempts"] == result["providerCost"] == 0
        assert result["authorityEffect"] == "none" and result["productOutcome"] == "unavailable"

def test_duplicate_display_is_suppressed_and_exhaustion_dead_letters():
    duplicate=evaluate_fixture("duplicate-display","enforce",NOW,"operator:fixture","b"*64)
    dead=evaluate_fixture("retry-exhaustion","enforce",NOW,"operator:fixture","b"*64)
    assert duplicate["displayCount"] == 1 and dead["deadLetterCount"] == 1
