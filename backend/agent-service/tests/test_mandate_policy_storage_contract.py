"""Static ownership checks for the local repository and its migration contract."""
from pathlib import Path
ROOT=Path(__file__).parents[2]
def test_timescale_repository_has_closed_tables_atomic_claim_and_separate_conflict():
    source=(ROOT/"agent-service/src/moeazi_agent/mandate_policy_storage.py").read_text()
    assert "_TABLES=frozenset" in source and "FOR UPDATE" in source
    assert "async with self.engine.begin()" in source and "async def _conflict" in source
    assert "mandate_policy_idempotency_conflict" in source and "activation_fork" in source
def test_migration_has_scoped_immutable_bundle_and_claim_contracts():
    sql=(ROOT/"agent-service/migrations/030_mandate_policy_semantic_fidelity.sql").read_text()
    for token in ("mandate_policy_artifact_links","mandate_policy_request_claim_unique","mandate_policy_bundle_generic_run","mandate_policy_append_only","mandate_policy_activation_fold"):
        assert token in sql
    assert "agent_test_center_runs" in sql and "scope_hash" in sql
def test_test_center_feature18_uses_timescale_not_product_policy():
    api=(ROOT/"agent-service/src/moeazi_agent/test_center_api.py").read_text()
    helper=(ROOT/"agent-service/src/moeazi_agent/test_center_mandate_policy.py").read_text()
    assert "persist_mandate_policy" in api and "TimescaleMandatePolicyRepository" in helper and "test_center_bundle" in helper
    assert "mandate_policy" not in (ROOT/"convex/helpers/agentPolicy.ts").read_text()
