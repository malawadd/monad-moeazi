from datetime import datetime,timezone
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def test_tier_thresholds_are_monotone():
    low=evaluate_fixture("consent-ordinary-accept","enforce",NOW,"operator","a"*64)
    elevated=evaluate_fixture("consent-elevated-boundary","enforce",NOW,"operator","b"*64)
    high=evaluate_fixture("consent-high-boundary","enforce",NOW,"operator","c"*64)
    assert [low["tier"],elevated["tier"],high["tier"]]==["ordinary","elevated","high"]
