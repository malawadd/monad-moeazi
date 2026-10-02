from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .risk_tiered_consent_scope_contracts import Frozen,ConsentScope,Hash
from .risk_tiered_consent_canonical import digest
class SourceReceipt(Frozen):
    source_id:Literal["proposal","policy","risk","route","quote","signer","emergency","authority","uncertainty"]
    scope:ConsentScope; revision:int=Field(ge=1,le=999999); sequence:int=Field(ge=1,le=999999)
    predecessor_hash:Hash|None=Field(default=None,pattern=r"^[a-f0-9]{64}$"); status:Literal["current","stale","disputed","missing"]
    provenance:Literal["local_fixture_untrusted"]; observed_at:datetime; expires_at:datetime; utilization_bps:int=Field(ge=0,le=10000)
    novel:bool=False; near_liquidation:bool=False; irreversible:bool=False; privacy_downgrade:bool=False; source_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def verify(self):
        if self.source_hash!=digest(self.model_dump(exclude={"source_hash"})): raise ValueError("source_hash_mismatch")
        return self
class ApprovalInputManifest(Frozen):
    scope:ConsentScope; sources:tuple[SourceReceipt,...]; created_at:datetime; manifest_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def verify(self):
        if self.manifest_hash!=digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest_hash_mismatch")
        return self
class Feature19ContextBinding(Frozen):
    run_id:str=Field(pattern=r"^run-[a-f0-9]{32}$"); operator_test_id:str=Field(pattern=r"^operator_[a-f0-9]{32}$")
    decision_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    control_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); request_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    status:Literal["requires_revalidation"]="requires_revalidation"; non_authorizing:Literal[True]=True; product_status:Literal["unavailable"]="unavailable"; authority_effect:Literal["none"]="none"
