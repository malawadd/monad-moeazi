"""Independent, small oracle: deliberately does not import the evaluator."""
from .promotion_registry import scenarios
ORDER=("eligible","hold","reject","demote","block","kill")
def expected(identifier, mode):
    kind=next(x["kind"] for x in scenarios() if x["id"]==identifier)
    value="eligible"
    if kind in {"underpowered","uncertain","corrected"}: value="hold"
    if kind in {"reject","missing-cost"}: value="reject"
    if kind=="demote": value="demote"
    if kind in {"drift","rollback-block"}: value="block"
    if kind in {"boundary","kill"}: value="kill"
    return "hold" if mode=="observe" else value
