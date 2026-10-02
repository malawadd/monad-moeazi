"""Only checked-in pack identifiers can be selected by the Test Center."""
from __future__ import annotations
from .safety_assurance_registry import PACKS,OPERATIONS
from .safety_assurance_evaluator import evaluate
def scenario_registry(): return tuple({"id":p,"operation":"run_pack"} for p in PACKS)
def evaluate_fixture(scenario_id,mode,now,operator,run_hash,controls=None): return evaluate(scenario_id,mode,now,operator,run_hash,controls)
