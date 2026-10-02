"""Display-only fragments. They cannot become authority inputs."""
from __future__ import annotations
from typing import Literal
from pydantic import Field
from .effective_authority_scope_contracts import Frozen, Hash
class BoundaryFragment(Frozen):
    kind: Literal["gate","sizing","policy","calibration"]
    owner_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["complete","partial","unknown","conflict"]
    safe_code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    non_authorizing: Literal[True] = True
class BoundaryExplanation(Frozen):
    fragments: tuple[BoundaryFragment,...]
    status: Literal["partial","unknown"]
    non_authorizing: Literal[True] = True
    product_status: Literal["unavailable"] = "unavailable"
