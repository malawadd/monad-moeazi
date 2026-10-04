"""Checked-in fixture entry point. No production schedule owner is exposed."""
from .schedule_sync_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,controls)
