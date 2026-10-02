from datetime import datetime,timezone
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def test_material_route_change_invalidates_without_dispatch():
    value=evaluate_fixture("consent-material-route-delta","enforce",NOW,"operator","a"*64)
    assert value["comparisonOutcome"]=="invalidated"
    assert not value["dispatchAvailable"]
def test_expiry_is_terminal_at_or_after_packet_expiry():
    value=evaluate_fixture("consent-expired","enforce",NOW,"operator","b"*64)
    assert value["lifecycle"]=="expired" and value["nonceState"]=="consumed"
