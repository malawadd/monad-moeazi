"""Independent expected verdict oracle; deliberately does not import evaluator."""
from .analytical_diversity_registry import scenarios
def expected(identifier, mode):
 family=next(row["family"] for row in scenarios() if row["id"]==identifier)
 verdict="supported" if family=="supported" else "inconclusive" if family=="sparse" else "blocked" if family=="lineage" else "exploratory"
 return "exploratory" if mode=="observe" and verdict=="supported" else verdict
