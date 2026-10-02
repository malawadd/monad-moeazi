from __future__ import annotations
from typing import Literal
from pydantic import Field
from .risk_tiered_consent_scope_contracts import Frozen,Hash
class DeltaItem(Frozen): field_id:str; direction:Literal["equal","maximum","minimum"]; outcome:Literal["same","favorable","neutral","breach"]
class PostApprovalComparison(Frozen):
    packet_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); outcome:Literal["within_bounds_favorable","within_bounds_neutral","invalidated"]
    deltas:tuple[DeltaItem,...]; reason_codes:tuple[str,...]; comparison_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    dispatch_available:Literal[False]=False; product_available:Literal[False]=False
