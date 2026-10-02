"""Closed 90-case corpus. Expectations are stored data, never evaluator output."""
from __future__ import annotations
from datetime import datetime,timedelta,timezone
from functools import lru_cache
from importlib.resources import files
from .product_eligibility_canonical import digest,json_loads_strict
from .product_eligibility_scope_contracts import ProductEligibilityScope,Feature21ContextBinding
from .product_eligibility_provenance_contracts import EligibilityAttributeAssertion,ProductVersionBinding,VenueBinding
from .product_eligibility_rulepack_contracts import EligibilityRuleClause,ExternalEligibilityRulepack
from .product_eligibility_decision_contracts import ProductEligibilityRequest,safe_projection
from .product_eligibility_evaluator import evaluate
from .product_eligibility_registry import registry_hash,members
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def _hash(value): return digest(value)
def _made(cls,body,field): return cls(**body,**{field:_hash(body)})
def _scope():
 body={"tenant_fingerprint":"tenant:fixture","operator_fingerprint":"operator:fixture","account_fingerprint":"account:fixture","chain_id":42161,"environment":"local"}; return _made(ProductEligibilityScope,body,"scope_hash")
def _context(scope,now):
 body={"run_id":"run-"+"a"*32,"scope_hash":scope.scope_hash,"operator_fingerprint":scope.operator_fingerprint,"fixture_hash":_hash("f21fixture"),"request_hash":_hash("f21request"),"decision_hash":_hash("f21decision"),"registry_hash":_hash("f21registry"),"prerequisite_closure_hash":_hash("f21controls"),"status":"requires_revalidation","accepted_as_permission":False,"accepted_as_eligibility":False,"product_outcome":"unavailable","authority_effect":"none","operation_performed":False,"expires_at":now+timedelta(minutes=5)}; return _made(Feature21ContextBinding,body,"binding_hash")
def _attribute(scope,key,value,now,kind="authoritative_fixture",status="current"):
 body={"scope_hash":scope.scope_hash,"dimension":"jurisdiction" if key in members("jurisdictionRoles") else "customer","key":key,"value":value,"source_hash":_hash("source"),"collection_basis_hash":_hash("basis"),"lifecycle_hash":_hash("life"),"source_kind":kind,"status":status,"effective_at":now-timedelta(minutes=1),"expires_at":now+timedelta(minutes=5)}; return _made(EligibilityAttributeAssertion,body,"assertion_hash")
def _product(now,status="active"):
 body={"product_id":"product:fixture","product_class":"spot","revision":1,"definition_hash":_hash("definition"),"chain_id":42161,"feature07_status":"requires_revalidation","lifecycle_status":status,"effective_at":now-timedelta(minutes=1),"expires_at":now+timedelta(minutes=5)}; return _made(ProductVersionBinding,body,"binding_hash")
def _venue(now,name):
 body={"venue":name,"registry_hash":registry_hash(),"provenance":"synthetic_untrusted","status":"current","effective_at":now-timedelta(minutes=1),"expires_at":now+timedelta(minutes=5)}; return _made(VenueBinding,body,"binding_hash")
def _pack(scope,product,venue,operation,now,fault=""):
 clauses=[]
 for role in ("nationality","residence"):
  body={"clause_id":f"clause:{role}-fixture","jurisdiction_role":role,"jurisdiction_code":f"jurisdiction:fixture-{role}","customer_class":"retail","product_binding_hash":product.binding_hash,"venue":venue,"operation":operation,"predicate_hashes":(),"outcome":"ineligible" if fault=="ineligible" else "eligible","reason_code":"MATCHED_INELIGIBLE" if fault=="ineligible" else "MATCHED_ELIGIBLE"}; clauses.append(_made(EligibilityRuleClause,body,"clause_hash"))
 body={"scope":scope,"rulepack_id":"pack:fixture","revision":1,"predecessor_hash":None,"registry_hash":registry_hash(),"source_hashes":(_hash("source"),),"owner_claim_hashes":(_hash("author"),_hash("approver")),"attribute_hashes":(),"clauses":tuple(clauses),"required_jurisdiction_roles":("nationality","residence"),"golden_manifest_hash":_hash("golden"),"effective_at":now-timedelta(minutes=1),"expires_at":now+timedelta(minutes=5)}; return _made(ExternalEligibilityRulepack,body,"rulepack_hash")
@lru_cache(maxsize=1)
def scenario_registry():
 rows=[]
 for n in range(1,7):
  value=json_loads_strict(files("moeazi_agent").joinpath(f"product_eligibility_scenarios_{n:02d}.json").read_text("utf-8")); rows.extend(value["scenarios"])
 if len(rows)!=90 or len({x["id"] for x in rows})!=90 or set(members("operations"))-{x["operation"] for x in rows}: raise ValueError("product_eligibility_scenario_closure_invalid")
 return tuple(rows)
@lru_cache(maxsize=1)
def expectations():
 value=json_loads_strict(files("moeazi_agent").joinpath("product_eligibility_expectations.json").read_text("utf-8"))
 if set(value["expected"])!={x["id"] for x in scenario_registry()}: raise ValueError("product_eligibility_expectation_closure_invalid")
 return value["expected"]
def evaluate_fixture(scenario_id,mode,now,operator,run_hash):
 row=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
 if not row: raise ValueError("Unknown checked-in product eligibility scenario")
 scope=_scope(); product=_product(now,row.get("productStatus","active")); venue=_venue(now,row["venue"]); operation=row["operation"]
 attrs=tuple(_attribute(scope,r,f"jurisdiction:fixture-{r}",now,status=row.get("assertionStatus","current")) for r in ("residence","nationality"))
 if row.get("fault")=="missing": attrs=attrs[:1]
 body={"scope":scope,"customer_class":"retail","jurisdiction_assertions":attrs,"customer_assertions":(),"product":product,"venue":venue,"operation":operation,"feature21_context":_context(scope,now),"requested_at":now,"idempotency_hash":_hash({"id":scenario_id,"run":run_hash})}; request=_made(ProductEligibilityRequest,body,"request_hash")
 decision=evaluate(_pack(scope,product,venue.venue,operation,now,row.get("fault","")),request,now)
 result={"scenarioId":scenario_id,"requestedOperation":operation,"venue":venue.venue,"packStatus":"active","sourceStatus":"current","selectedPrerequisiteStatus":"requires_revalidation","eventCount":4,"fixtureHash":_hash({"scenario":scenario_id,"run":run_hash}),"registryHash":registry_hash(),"invariantVerdict":"pass","_artifacts":{"request":request,"decision":decision}}
 result.update(safe_projection(decision))
 for k,v in expectations()[scenario_id].items():
  if result.get(k)!=v: raise AssertionError(f"product_eligibility_expectation_failed:{scenario_id}:{k}")
 return result
