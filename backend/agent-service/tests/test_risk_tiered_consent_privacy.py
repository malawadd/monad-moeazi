from datetime import datetime,timezone
from moeazi_agent.risk_tiered_consent_scenarios import evaluate_fixture
def test_projection_has_no_packet_body_identity_signature_or_authority():
    result=evaluate_fixture("consent-ordinary-accept","enforce",datetime(2026,9,7,tzinfo=timezone.utc),"operator","a"*64)
    joined=" ".join(result).lower()
    assert all(token not in joined for token in ("owner_fingerprint","signature","challenge_hash","scope"))
    assert result["authorityEffect"]=="none" and result["dispatchAvailable"] is False
