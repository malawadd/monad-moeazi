"""Bounded customer-safe projection; it does not expose receipt bodies or advice."""
from __future__ import annotations
from .effective_authority_decision_contracts import EffectiveAuthorityDecision
def project(decision: EffectiveAuthorityDecision) -> dict:
    return {"effectiveCapability":decision.capability,"phase":decision.phase,"coverage":decision.coverage,
      "reasonCodes":[item.reason_code for item in decision.reasons],"remediationCodes":[item.remediation_code for item in decision.reasons],
      "decisionHash":decision.decision_hash[:16],"registryHash":decision.registry_hash[:16],"nonAuthorizing":True,
      "productOutcome":"unavailable","authorityEffect":"none"}
