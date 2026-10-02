from datetime import datetime, timezone
from moeazi_agent.mandate_policy_scenarios import evaluate_fixture, scenario_registry
def test_adversarial_corpus_is_checked_in_and_never_authorizes_product():
    names={row["id"] for row in scenario_registry()}
    required={"mpf-direct-typed-parity","mpf-duplicate-clause","mpf-market-mixed","mpf-wrong-tenant","mpf-declined-consent","mpf-three-revision-replay","mpf-projector-default-bypass"}
    assert required<=names
    now=datetime(2026,1,1,tzinfo=timezone.utc)
    for row in scenario_registry():
        result=evaluate_fixture(row["id"],"observe",now,"operator","a"*64)
        assert result["productOutcome"]=="unavailable" and result["authorityEffect"]=="none"
