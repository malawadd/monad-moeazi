from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .product_eligibility_scope_contracts import Frozen,ProductEligibilityScope
from .product_eligibility_canonical import digest
from .product_eligibility_registry import members,registry_hash,limit
class EligibilityPredicate(Frozen):
 dimension:Literal["jurisdiction","customer"]; key:str; value:str; predicate_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.predicate_hash!=digest(self.model_dump(exclude={"predicate_hash"},mode="python")): raise ValueError("predicate_hash_mismatch")
  return self
class EligibilityRuleClause(Frozen):
 clause_id:str=Field(pattern=r"^clause:[a-z0-9-]{3,64}$"); jurisdiction_role:str; jurisdiction_code:str; customer_class:str; product_binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); venue:str; operation:str; predicate_hashes:tuple[str,...]=(); outcome:Literal["eligible","ineligible","unknown","manual_legal_review_required"]; reason_code:str; clause_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.jurisdiction_role not in members("jurisdictionRoles") or self.customer_class not in members("customerClasses") or self.venue not in members("venues") or self.operation not in members("operations") or self.reason_code not in members("reasonCodes") or self.predicate_hashes!=tuple(sorted(set(self.predicate_hashes))) or self.clause_hash!=digest(self.model_dump(exclude={"clause_hash"},mode="python")): raise ValueError("clause_invalid")
  return self
class ExternalEligibilityRulepack(Frozen):
 scope:ProductEligibilityScope; rulepack_id:str=Field(pattern=r"^pack:[a-z0-9-]{3,64}$"); revision:int=Field(ge=1); predecessor_hash:str|None=Field(default=None,pattern=r"^[a-f0-9]{64}$"); registry_hash:str; source_hashes:tuple[str,...]; owner_claim_hashes:tuple[str,...]; attribute_hashes:tuple[str,...]; clauses:tuple[EligibilityRuleClause,...]; required_jurisdiction_roles:tuple[str,...]; golden_manifest_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); effective_at:datetime; expires_at:datetime; rulepack_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  ids=tuple(x.clause_id for x in self.clauses)
  if self.expires_at<=self.effective_at or (self.revision==1)!=(self.predecessor_hash is None) or self.registry_hash!=registry_hash() or not self.clauses or len(self.clauses)>limit("maxClauses") or ids!=tuple(sorted(set(ids))) or self.required_jurisdiction_roles!=tuple(sorted(set(self.required_jurisdiction_roles))) or not set(self.required_jurisdiction_roles).issubset(members("jurisdictionRoles")) or self.rulepack_hash!=digest(self.model_dump(exclude={"rulepack_hash"},mode="python")): raise ValueError("rulepack_invalid")
  return self
