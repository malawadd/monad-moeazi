from datetime import datetime,timezone
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture
def test_packet_uses_every_registry_field_once_in_safe_projection():
    result=evaluate_fixture("consent-ordinary-accept","enforce",datetime(2026,9,7,tzinfo=timezone.utc),"operator","a"*64)
    assert result["fieldCoverage"]==9
