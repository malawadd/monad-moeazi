"""Only Test Center bridge for portfolio sizing fixtures."""
from .portfolio_sizing_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None):
 return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
