import pytest
from moeazi_agent.operator_qualification_storage import OperatorQualificationRepository, _TABLES

@pytest.mark.asyncio
async def test_storage_table_selection_is_closed_before_sql_execution():
    repo=OperatorQualificationRepository(None)
    with pytest.raises(ValueError,match="not closed"):
        await repo._put(None,"operator_qualification_conflicts;DROP TABLE x","conflict_hash",{},"a"*64)
    assert "operator_qualification_conflicts" in _TABLES and "agent_test_center_runs" not in _TABLES

def test_storage_binds_scope_and_tenant_for_current_grant_fold():
    source=open("agent-service/src/moeazi_agent/operator_qualification_storage.py",encoding="utf8").read()
    assert "tenant_fingerprint=:t" in source and "scope_id=:s" in source
    assert "operator_qualification_request_claims" in source and "FOR UPDATE" in source
