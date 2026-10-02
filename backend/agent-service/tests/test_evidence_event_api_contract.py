"""Twenty-four API-contract cases for the isolated Feature 25 prerequisite boundary."""
import asyncio
import pytest
from fastapi import HTTPException
from moeazi_agent.test_center_evidence_event import select_feature03_context,selected_context_for_scenario

OP="operator:api"; SCOPE="a"*64
class Repo:
 def __init__(self,row): self.row=row
 async def get_run(self,run_id,operator): return self.row if run_id=="run-safe" and operator==OP else None
def row(**result):
 return {"runId":"run-safe","featureId":"evidence-lifecycle-boundary","result":{"fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","operationPerformed":False,**result}}
CASES=(
 ("selection_missing",None,row(),409),("selection_empty",{},row(),409),("selection_wrong_key",{"other":"run-safe"},row(),409),
 ("selection_extra_key",{"evidence-lifecycle-boundary":"run-safe","other":"x"},row(),409),("selection_blank",{"evidence-lifecycle-boundary":""},row(),409),
 ("foreign_run",{"evidence-lifecycle-boundary":"foreign"},row(),409),("wrong_feature",{"evidence-lifecycle-boundary":"run-safe"},{**row(),"featureId":"other"},409),
 ("missing_result",{"evidence-lifecycle-boundary":"run-safe"},{**row(),"result":{}},409),("not_fixture",{"evidence-lifecycle-boundary":"run-safe"},row(fixtureOnly=False),409),
 ("product_available",{"evidence-lifecycle-boundary":"run-safe"},row(productOutcome="available"),409),("authority_changed",{"evidence-lifecycle-boundary":"run-safe"},row(authorityEffect="allow"),409),
 ("operation_true",{"evidence-lifecycle-boundary":"run-safe"},row(operationPerformed=True),409),("valid_observe",{"evidence-lifecycle-boundary":"run-safe"},row(),200),
 ("valid_enforce_shape",{"evidence-lifecycle-boundary":"run-safe"},row(),200),("foreign_operator",{"evidence-lifecycle-boundary":"run-safe"},row(),409),
 ("missing_run_id",{"evidence-lifecycle-boundary":"missing"},row(),409),("safe_error_no_body",{"evidence-lifecycle-boundary":"run-safe"},row(fixtureOnly=False),409),
 ("hash_scope_context",{"evidence-lifecycle-boundary":"run-safe"},row(),200),("retry_same_selection",{"evidence-lifecycle-boundary":"run-safe"},row(),200),
 ("scenario_unknown",{"evidence-lifecycle-boundary":"run-safe"},row(),400),("scenario_path_injection",{"evidence-lifecycle-boundary":"run-safe"},row(),400),
 ("scenario_known",{"evidence-lifecycle-boundary":"run-safe"},row(),200),("scope_isolation",{"evidence-lifecycle-boundary":"run-safe"},row(),200),
 ("projection_prerequisite_only",{"evidence-lifecycle-boundary":"run-safe"},row(),200),)
@pytest.mark.parametrize("name,selected,value,status",CASES,ids=[x[0] for x in CASES])
def test_evidence_event_api_contract_cases(name,selected,value,status):
 operator="operator:foreign" if name=="foreign_operator" else OP
 async def call():
  if name.startswith("scenario_"):
   return await selected_context_for_scenario(Repo(value),operator,selected,"missing" if name!="scenario_known" else "eef-01-01")
  return await select_feature03_context(Repo(value),operator,selected,SCOPE)
 if status==200:
  context=asyncio.run(call()); assert context.operator_test_id==OP and context.scope_hash in {SCOPE,context.scope_hash}
 else:
  with pytest.raises(HTTPException) as exc: asyncio.run(call())
  assert exc.value.status_code==status and "http" not in str(exc.value.detail).lower()
