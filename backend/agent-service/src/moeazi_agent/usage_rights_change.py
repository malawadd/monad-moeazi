"""Prospective change classification without mutating a pack or historical decision."""
from .usage_rights_canonical import digest

def classify(previous, candidate):
    if candidate is None: return {"direction": "deactivate", "changeHash": digest({"previous": previous.rulepack_hash})}
    if previous is None: return {"direction": "loosening", "changeHash": digest({"candidate": candidate.rulepack_hash})}
    if candidate.scope.scope_hash != previous.scope.scope_hash or candidate.revision != previous.revision + 1 or candidate.predecessor_hash != previous.rulepack_hash:
        raise ValueError("prospective_rulepack_chain_invalid")
    old = {(x.operation, x.subject_class, x.subject_revision, x.disposition, x.obligations) for x in previous.assertions}
    new = {(x.operation, x.subject_class, x.subject_revision, x.disposition, x.obligations) for x in candidate.assertions}
    direction = "tightening" if new <= old else "loosening" if old <= new else "mixed"
    return {"direction": direction, "changeHash": digest({"previous": previous.rulepack_hash, "candidate": candidate.rulepack_hash, "direction": direction})}
