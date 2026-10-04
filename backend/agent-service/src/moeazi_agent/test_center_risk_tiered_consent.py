"""Narrow Feature 20 helper; generic Test Center code receives only safe projection data."""
from __future__ import annotations
from .risk_tiered_consent_test_center_adapter import evaluate
from .risk_tiered_consent_storage import RiskTieredConsentRepository
from .risk_tiered_consent_source_contracts import Feature19ContextBinding
def evaluate_consent(scenario_id,mode,now,operator,run_hash):
    result=evaluate(scenario_id,mode,now,operator,run_hash)
    return result,result.pop("_artifacts")
async def persist_consent(engine,operator,idempotency_key,request_hash,artifacts,payload):
    return await RiskTieredConsentRepository(engine).persist_bundle(operator,idempotency_key,request_hash,artifacts,payload)
async def select_feature19_context(repository,operator,run_id):
    run=await repository.get_run(run_id,operator); result=run and run.get("result",{})
    if not run or run.get("featureId")!="effective-authority-decision" or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("nonAuthorizing") is not True: raise ValueError("feature19_context_unavailable")
    return Feature19ContextBinding(run_id=run["runId"],operator_test_id=operator,decision_hash=result["decisionHash"],registry_hash=run["registryHash"],control_hash=run["controlHash"],request_hash=run["requestHash"])
