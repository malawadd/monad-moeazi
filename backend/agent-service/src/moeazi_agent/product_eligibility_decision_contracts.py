from __future__ import annotations
from datetime import datetime,timezone
from typing import Literal
from pydantic import Field,model_validator
from .product_eligibility_scope_contracts import Frozen,ProductEligibilityScope,Feature21ContextBinding
from .product_eligibility_provenance_contracts import EligibilityAttributeAssertion,ProductVersionBinding,VenueBinding
from .product_eligibility_canonical import digest
from .product_eligibility_registry import members
class ProductEligibilityRequest(Frozen):
 scope:ProductEligibilityScope; customer_class:str; jurisdiction_assertions:tuple[EligibilityAttributeAssertion,...]; customer_assertions:tuple[EligibilityAttributeAssertion,...]; product:ProductVersionBinding; venue:VenueBinding; operation:str; feature21_context:Feature21ContextBinding; requested_at:datetime; idempotency_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); request_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  attrs=self.jurisdiction_assertions+self.customer_assertions
  if self.customer_class not in members("customerClasses") or self.operation not in members("operations") or self.venue.venue not in members("venues") or len({x.assertion_hash for x in attrs})!=len(attrs) or any(x.scope_hash!=self.scope.scope_hash for x in attrs) or self.feature21_context.scope_hash!=self.scope.scope_hash or self.feature21_context.operator_fingerprint!=self.scope.operator_fingerprint or self.request_hash!=digest(self.model_dump(exclude={"request_hash"},mode="python")): raise ValueError("eligibility_request_invalid")
  return self
class EligibilityLeafResult(Frozen):
 jurisdiction_role:str; outcome:Literal["eligible","ineligible","unknown","manual_legal_review_required"]; reason_code:str; clause_hash:str|None=None
class ProductEligibilityDecision(Frozen):
 request_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); rulepack_hash:str|None=None; source_hashes:tuple[str,...]=(); owner_claim_hashes:tuple[str,...]=(); attribute_hashes:tuple[str,...]=(); product_binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); venue_binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); feature21_context_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); leaf_results:tuple[EligibilityLeafResult,...]; outcome:Literal["eligible","ineligible","unknown","manual_legal_review_required"]; reason_codes:tuple[str,...]; expires_at:datetime; predecessor_decision_hash:str|None=None; fixture_only:Literal[True]=True; accepted_for_product:Literal[False]=False; not_legal_advice:Literal[True]=True; product_outcome:Literal["unavailable"]="unavailable"; authority_effect:Literal["none"]="none"; operation_performed:Literal[False]=False; external_attempts:Literal[0]=0; provider_cost:Literal[0]=0; decision_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if not self.leaf_results or tuple(x.jurisdiction_role for x in self.leaf_results)!=tuple(sorted({x.jurisdiction_role for x in self.leaf_results})) or self.reason_codes!=tuple(sorted(set(self.reason_codes))) or self.decision_hash!=digest(self.model_dump(exclude={"decision_hash"},mode="python")): raise ValueError("eligibility_decision_invalid")
  return self
def safe_projection(decision:ProductEligibilityDecision)->dict:
 return {"eligibilityOutcome":decision.outcome,"simulatedBoundary":"would_pass_fixture" if decision.outcome=="eligible" else "would_block_fixture","jurisdictionLeafCount":len(decision.leaf_results),"reasonCodes":list(decision.reason_codes),"decisionHash":decision.decision_hash[:16],"fixtureOnly":True,"notLegalAdvice":True,"productOutcome":"unavailable","authorityEffect":"none","operationPerformed":False,"externalAttempts":0,"providerCost":0}
