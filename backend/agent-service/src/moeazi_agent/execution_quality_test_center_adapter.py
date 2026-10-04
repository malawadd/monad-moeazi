"""Only bridge from the Test Center to Feature 32's non-networked fixture plane."""
from .execution_quality_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
