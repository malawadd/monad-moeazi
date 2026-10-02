"""Pure exact-match eligibility evaluator; never calls a source, provider, or venue."""
from datetime import timedelta
from .product_eligibility_decision_contracts import ProductEligibilityDecision,EligibilityLeafResult,ProductEligibilityRequest
from .product_eligibility_rulepack_contracts import ExternalEligibilityRulepack
from .product_eligibility_canonical import digest
from .product_eligibility_registry import limit
RANK={"eligible":0,"unknown":1,"manual_legal_review_required":2,"ineligible":3}
def _result(request,pack,leaves,now):
 outcome=max((x.outcome for x in leaves),key=RANK.get); expires=[now+timedelta(seconds=limit("decisionTtlSeconds")),request.product.expires_at,request.venue.expires_at,request.feature21_context.expires_at]
 if pack: expires.append(pack.expires_at)
 body={"request_hash":request.request_hash,"rulepack_hash":pack.rulepack_hash if pack else None,"source_hashes":pack.source_hashes if pack else (),"owner_claim_hashes":pack.owner_claim_hashes if pack else (),"attribute_hashes":tuple(sorted(x.assertion_hash for x in request.jurisdiction_assertions+request.customer_assertions)),"product_binding_hash":request.product.binding_hash,"venue_binding_hash":request.venue.binding_hash,"feature21_context_hash":request.feature21_context.binding_hash,"leaf_results":tuple(sorted(leaves,key=lambda x:x.jurisdiction_role)),"outcome":outcome,"reason_codes":tuple(sorted(set(x.reason_code for x in leaves))),"expires_at":min(expires),"predecessor_decision_hash":None,"fixture_only":True,"accepted_for_product":False,"not_legal_advice":True,"product_outcome":"unavailable","authority_effect":"none","operation_performed":False,"external_attempts":0,"provider_cost":0}
 return ProductEligibilityDecision(**body,decision_hash=digest(body))
def evaluate(pack:ExternalEligibilityRulepack|None,request:ProductEligibilityRequest,now):
 if not pack or pack.scope.scope_hash!=request.scope.scope_hash or not(pack.effective_at<=now<pack.expires_at) or not(now<request.feature21_context.expires_at):
  return _result(request,None,[EligibilityLeafResult(jurisdiction_role="residence",outcome="unknown",reason_code="PACK_UNAVAILABLE")],now)
 if request.product.lifecycle_status in {"disputed","rebaseline_required","expired"} or (request.product.lifecycle_status=="restricted" and request.operation not in {"cancel","reduce","settle","reconcile"}):
  return _result(request,pack,[EligibilityLeafResult(jurisdiction_role=x,outcome="unknown",reason_code="PRODUCT_RESTRICTED") for x in pack.required_jurisdiction_roles],now)
 leaves=[]
 for role in pack.required_jurisdiction_roles:
  assertions=[x for x in request.jurisdiction_assertions if x.key==role and x.status=="current" and x.effective_at<=now<x.expires_at]
  if len(assertions)!=1: leaves.append(EligibilityLeafResult(jurisdiction_role=role,outcome="manual_legal_review_required" if len(assertions)>1 else "unknown",reason_code="ASSERTION_CONFLICT" if len(assertions)>1 else "ASSERTION_MISSING")); continue
  candidates=[c for c in pack.clauses if c.jurisdiction_role==role and c.jurisdiction_code==assertions[0].value and c.customer_class==request.customer_class and c.product_binding_hash==request.product.binding_hash and c.venue==request.venue.venue and c.operation==request.operation]
  if len(candidates)!=1: leaves.append(EligibilityLeafResult(jurisdiction_role=role,outcome="manual_legal_review_required" if candidates else "unknown",reason_code="PACK_CONFLICT" if candidates else "OPERATION_MISMATCH")); continue
  c=candidates[0]; leaves.append(EligibilityLeafResult(jurisdiction_role=role,outcome=c.outcome,reason_code=c.reason_code,clause_hash=c.clause_hash))
 return _result(request,pack,leaves,now)
