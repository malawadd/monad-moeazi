"""Only bridge from isolated Test Center to Feature 30 fixtures."""
from .evidence_integrity_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
