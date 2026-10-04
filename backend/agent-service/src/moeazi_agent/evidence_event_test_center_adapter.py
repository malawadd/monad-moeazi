"""Fixture-only bridge; deliberately no external adapter implementation."""
from .evidence_event_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
