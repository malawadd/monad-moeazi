from datetime import datetime,timezone,timedelta
from moeazi_agent.risk_tiered_consent_scenarios import _scope,_manifest
from moeazi_agent.risk_tiered_consent_assessor import assess
from moeazi_agent.risk_tiered_consent_packet import build
from moeazi_agent.risk_tiered_consent_scope_contracts import ApprovalRequest
from moeazi_agent.risk_tiered_consent_canonical import digest
from moeazi_agent.risk_tiered_consent_nonce import claim
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def test_one_challenge_is_bound_to_one_packet_and_terminal_claim():
    row={"utilization":0,"mutation":"none"}; scope=_scope(); packet=build(scope,ApprovalRequest(mode="Approval",request_hash=digest("r"),idempotency_hash=digest("i")),assess(_manifest(scope,row),NOW),NOW)
    accepted=claim(packet,"accepted",NOW); expired=claim(packet,"accepted",packet.expires_at)
    assert accepted["challengeHash"]==expired["challengeHash"] and accepted["outcome"]=="accepted" and expired["outcome"]=="expired"
