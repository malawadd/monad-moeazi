"""Allowlisted aggregate projection for a fixture decision."""
from .usage_rights_decision_contracts import safe_projection

def project(decision):
    return safe_projection(decision)
