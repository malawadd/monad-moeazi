from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field
from .risk_tiered_consent_scope_contracts import Frozen,Hash
class ApprovalRiskAssessment(Frozen):
    tier:Literal["ordinary","elevated","high"]
    ceremony:Literal["owner_proof","fresh_auth","deliberate_review","none"]
    issuance:Literal["issued","blocked","not_applicable"]
    triggers:tuple[str,...]; reason_codes:tuple[str,...]; source_coverage:Literal["complete","partial","conflict"]
    registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); assessed_at:datetime; expires_at:datetime
    non_authorizing:Literal[True]=True; product_status:Literal["unavailable"]="unavailable"; authority_effect:Literal["none"]="none"
    assessment_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
