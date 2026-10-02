from .claim_disagreement_registry import PACKS,pack
from .claim_disagreement_evaluator import evaluate
def scenario_registry(): return tuple({"id":x["id"],"operation":"compare_subjects"} for p in PACKS for x in pack(p))
def evaluate_fixture(scenario_id,mode,now,operator,run_hash,context=None): return evaluate(scenario_id,mode,now,operator,run_hash,context)
