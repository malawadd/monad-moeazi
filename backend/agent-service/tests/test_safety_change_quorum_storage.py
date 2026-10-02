from pathlib import Path

def test_migration_uses_append_only_tenant_scoped_claims():
    sql=Path("agent-service/migrations/028_safety_change_quorum.sql").read_text()
    assert "safety_change_reject_mutation" in sql and "PRIMARY KEY(operator_test_id,idempotency_key)" in sql
    assert "safety_change_qualification_evidence" in sql and "safety_change_test_center_bundles" in sql
