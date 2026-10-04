"""Feature 24 bridge: fixture inputs only, never a customer export adapter."""
from .portability_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash): return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
