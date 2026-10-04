from __future__ import annotations
from .risk_tiered_consent_scenarios import evaluate_fixture,scenario_registry
FEATURE_ID="risk-tiered-approval-consent"
def evaluate(scenario_id,mode,now,operator,run_hash):
    if not any(row["id"]==scenario_id for row in scenario_registry()): raise ValueError("Unknown checked-in risk tiered consent scenario")
    return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
