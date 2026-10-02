from pathlib import Path
import asyncio
import pytest
from moeazi_agent.safety_assurance_storage import AssuranceRepository,AssuranceConflict
SQL=(Path(__file__).parents[1]/"migrations"/"039_system_safety_assurance_corpus.sql").read_text()
def test_migration_is_append_only_and_operator_scoped():
 for name in ("runs","verdicts","roots","case_results","mutation_results","request_claims"):
  assert f"safety_assurance_{name}" in SQL
 assert "safety_assurance_append_only" in SQL and "BEFORE UPDATE OR DELETE" in SQL
 assert "UNIQUE(operator_test_id,run_hash)" in SQL
def test_storage_refuses_cross_operator_and_invalid_graph_before_io():
 class Engine: pass
 repo=AssuranceRepository(Engine())
 with pytest.raises(KeyError): asyncio.run(repo.persist_bundle("operator","key","a"*64,{},{}))
def test_conflict_type_is_explicit(): assert issubclass(AssuranceConflict,RuntimeError)
