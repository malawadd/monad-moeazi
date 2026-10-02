from moeazi_agent.risk_tiered_consent_canonical import digest
def test_artifact_hashes_are_sensitive_and_scope_qualified():
    left=digest({"scope":"a","packet":"p","outcome":"accepted"})
    right=digest({"scope":"b","packet":"p","outcome":"accepted"})
    assert left!=right
