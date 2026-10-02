from datetime import datetime,timezone
import pytest
from moeazi_agent.risk_tiered_consent_canonical import CanonicalError,canonical_json,json_loads_strict
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def test_canonical_rejects_floats_and_duplicate_keys():
    with pytest.raises(CanonicalError): canonical_json({"unsafe":1.5})
    with pytest.raises(CanonicalError): json_loads_strict('{"a":1,"a":2}')
def test_fixture_is_explicitly_non_authorizing():
    value=evaluate_fixture("consent-ordinary-accept","enforce",NOW,"operator","a"*64)
    assert value["fixtureOnly"] and not value["dispatchAvailable"]
    assert value["productOutcome"]=="unavailable" and value["externalAttempts"]==value["providerCost"]==0
