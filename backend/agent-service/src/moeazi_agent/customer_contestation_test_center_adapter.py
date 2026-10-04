"""Scenario-only Feature 23 adapter; no customer, identity, or provider input."""
from .customer_contestation_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash): return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
