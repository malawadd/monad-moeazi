"""Sanitized immutable decision contracts."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field
from .effective_authority_scope_contracts import Frozen, AuthorityScope, BoundaryIdentity, Hash

class ReasonProjection(Frozen): gate_id:str; reason_code:str; remediation_code:str; blocking:bool
class EffectiveAuthorityDecision(Frozen):
    scope: AuthorityScope; boundary: BoundaryIdentity; requested_mode: Literal["Shadow","Approval","Autopilot"]
    capability: Literal["ANALYZE_ONLY","SHADOW_SIMULATE","PREFLIGHT_ONLY","SUBMISSION_ELIGIBLE"]
    phase: Literal["ANALYZE_ONLY","SHADOW_SIMULATE","AWAITING_USER_APPROVAL","PREFLIGHT_ONLY","EXECUTION_BLOCKED","SUBMISSION_ELIGIBLE"]
    coverage: Literal["complete","partial","conflict"]
    reasons: tuple[ReasonProjection,...]; gate_hashes: tuple[Hash,...]
    registry_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$"); created_at: datetime; expires_at: datetime
    non_authorizing: Literal[True] = True; product_status: Literal["unavailable"] = "unavailable"; authority_effect: Literal["none"] = "none"
    decision_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
