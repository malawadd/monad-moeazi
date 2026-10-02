from __future__ import annotations
from datetime import datetime,timedelta,timezone
from importlib.resources import files
from .risk_tiered_consent_canonical import json_loads_strict,digest
from .risk_tiered_consent_scope_contracts import ConsentScope,ApprovalRequest
from .risk_tiered_consent_source_contracts import SourceReceipt,ApprovalInputManifest
from .risk_tiered_consent_assessor import assess
from .risk_tiered_consent_packet import build
from .risk_tiered_consent_receipt_contracts import SignerVerificationObservation,ApprovalConsentReceipt
from .risk_tiered_consent_nonce import validate_observation
from .risk_tiered_consent_compare import compare
from .risk_tiered_consent_projection import project
from .risk_tiered_consent_registry import source_ids
from .risk_tiered_consent_fixture_executor import FixtureConsentExecutor

NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def scenario_registry():
    rows=json_loads_strict(files("moeazi_agent").joinpath("risk_tiered_consent_scenarios_core.json").read_text())["scenarios"]
    if len({row["id"] for row in rows})!=len(rows) or any(set(row)!={"id","mode","utilization","mutation","outcome"} for row in rows): raise ValueError("consent_scenario_registry_invalid")
    return rows
def expectations():
    merged={}
    for name in ("risk_tiered_consent_expectations.json","risk_tiered_consent_expectations_identity.json","risk_tiered_consent_expectations_delta.json"):
        rows=json_loads_strict(files("moeazi_agent").joinpath(name).read_text())["expected"]
        if set(merged)&set(rows): raise ValueError("duplicate_consent_expectation")
        merged.update(rows)
    return merged
def _scope(suffix="fixture"):
    body={"tenant_fingerprint":f"tenant:{suffix}","account_fingerprint":f"account:{suffix}","strategy_fingerprint":f"strategy:{suffix}","proposal_fingerprint":f"proposal:{suffix}","owner_fingerprint":f"owner:{suffix}","owner_provider":"particle","chain_id":42161}
    return ConsentScope(**body,scope_hash=digest(body))
def _manifest(scope,row):
    rows=[]
    for name in source_ids():
        mutation=row["mutation"]; targeted=(mutation=="policy" and name=="policy") or (mutation=="emergency" and name=="emergency")
        status="stale" if mutation=="stale" or targeted else "disputed" if mutation=="disputed" else "current"
        body={"source_id":name,"scope":_scope("other") if mutation=="wrong_scope" and name=="risk" else scope,"revision":1,"sequence":1,"predecessor_hash":None,"status":status,"provenance":"local_fixture_untrusted","observed_at":NOW,"expires_at":NOW+timedelta(minutes=5),"utilization_bps":row["utilization"],"novel":mutation=="novel","near_liquidation":False,"irreversible":False,"privacy_downgrade":False}
        rows.append(SourceReceipt(**body,source_hash=digest(body)))
    if row["mutation"]=="fork": rows.append(rows[0])
    if row["mutation"]=="gap":
        item=rows[0].model_dump(exclude={"source_hash"}); item["sequence"]=2; rows[0]=SourceReceipt(**item,source_hash=digest(item))
    if row["mutation"]=="rollback":
        item=rows[0].model_dump(exclude={"source_hash"}); item["predecessor_hash"]=digest("wrong"); rows[0]=SourceReceipt(**item,source_hash=digest(item))
    body={"scope":scope,"sources":tuple(rows),"created_at":NOW}; return ApprovalInputManifest(**body,manifest_hash=digest(body))
def _feature19_reason(mutation): return {"feature19_missing":"FEATURE19_CONTEXT_MISSING","feature19_foreign":"FEATURE19_CONTEXT_FOREIGN"}.get(mutation)
def _receipt(packet,outcome,at):
    body={"packet_hash":packet.packet_hash,"challenge_hash":packet.challenge_hash,"outcome":outcome,"consumed_at":at}; return ApprovalConsentReceipt(**body,receipt_hash=digest(body))
def _exercise_consent(packet,mutation,now):
    executor=FixtureConsentExecutor()
    def attempt(requested):
        observation=SignerVerificationObservation(provider="magic" if mutation=="wrong_provider" else "particle",method="synthetic_owner_proof",expected_signer_fingerprint=packet.scope.owner_fingerprint,observed_signer_fingerprint=packet.scope.owner_fingerprint,packet_hash=packet.packet_hash,challenge_hash=packet.challenge_hash,verified_at=now,status="accepted")
        verified=validate_observation(packet,observation,now+timedelta(seconds=301) if mutation=="expired" else now)
        if mutation in {"replay","raw_signature"}: verified="rejected"
        if requested=="declined": verified="declined"
        return executor.consume(verified)
    if mutation=="double_click": outcome=attempt("accepted"); attempt("accepted")
    elif mutation=="race": outcome=attempt("accepted"); attempt("declined")
    else: outcome=attempt("declined" if mutation=="decline" else "accepted")
    if mutation=="conflict": executor.claim(packet.idempotency_hash,packet.request_hash); executor.claim(packet.idempotency_hash,digest({"different":packet.request_hash}))
    graph=executor.persist(("scope","manifest","assessment","packet","receipt","comparison"),mutation=="storage_failpoint")
    return executor,_receipt(packet,outcome,now),graph
def evaluate_fixture(scenario_id,mode,now,operator,run_hash):
    row=next((item for item in scenario_registry() if item["id"]==scenario_id),None)
    if not row: raise ValueError("Unknown checked-in risk tiered consent scenario")
    scope=_scope(); request=ApprovalRequest(mode=row["mode"],request_hash=digest({"scenario":scenario_id,"run":run_hash}),idempotency_hash=digest(scenario_id))
    manifest=_manifest(scope,row); assessment=assess(manifest,now,_feature19_reason(row["mutation"])); packet=receipt=comparison=None; executor=FixtureConsentExecutor(); graph="complete"
    if assessment.issuance=="issued" and row["mode"]=="Approval":
        packet=build(scope,request,assessment,now); executor,receipt,graph=_exercise_consent(packet,row["mutation"],now)
        if receipt.outcome=="accepted":
            baseline={"route":"a","venue":"v","channel":"protected","size":10,"leverage":2,"debit":10,"output":10,"risk":10,"uncertainty":0}; fresh=dict(baseline); mutation=row["mutation"]
            if mutation in fresh: fresh[mutation]="b" if mutation in {"route","venue"} else "public" if mutation=="channel" else 11 if mutation!="output" else 9
            comparison=compare(packet,baseline,fresh)
    counts={"current":sum(item.status=="current" for item in manifest.sources),"blocked":sum(item.status!="current" for item in manifest.sources)}
    observed,evidence=executor.evidence(comparison.outcome if comparison else None,assessment.issuance,row["mode"]!="Approval")
    result=project(assessment,packet,receipt,comparison,counts); result.update({"scenarioId":scenario_id,"mutationObserved":observed,"mutationEvidence":evidence,"storageGraph":graph,"fixtureHash":digest({"scenario":scenario_id,"run":run_hash})})
    for key,value in expectations().get(scenario_id,{}).items():
        if result.get(key)!=value: raise AssertionError(f"independent_expectation_failed:{scenario_id}:{key}")
    result["_artifacts"]={"scope":scope,"manifest":manifest,"assessment":assessment,"packet":packet,"receipt":receipt,"comparison":comparison,"execution":executor}; return result
