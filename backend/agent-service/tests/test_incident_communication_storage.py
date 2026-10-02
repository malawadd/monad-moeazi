def test_two_stage_storage_declares_atomic_intent_and_late_receipt_stage():
    source=open("agent-service/src/moeazi_agent/incident_communication_storage.py", encoding="utf-8").read()
    assert "fail_after_intent" in source and "incident_communication_outbox" in source
    assert "_commit_run" in source and "request_claims" in source
