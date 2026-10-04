"""Local checked-in assurance corpus bridge; no product adapter exists."""
from .safety_assurance_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,controls)
