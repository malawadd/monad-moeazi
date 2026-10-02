"""Checked-in-shaped synthetic fixtures; no caller evidence is accepted."""
from __future__ import annotations
from .source_value_attribution import candidate,estimate
from .source_value_canonical import digest
from .source_value_citations import resolve
from .source_value_definition_contracts import ManifestEvidenceItem,SpecialistCitationOutput,SourceValueScope
from .source_value_gate import evaluate as gate
from .source_value_registry import contracts,registry_hash,scenario
def evaluate_fixture(identifier,mode,now,operator,request_hash,context=None,controls=None):
 if mode not in {"observe","enforce"}: raise ValueError("source_value_mode")
 item=scenario(identifier); scope=SourceValueScope("fixture-tenant","fixture-account","ETH-USD",item["role"],"intraday")
 base=ManifestEvidenceItem("evidence-price","exact_venue_price_ohlc","root-price","2026-01-01T00:00:00Z","2028-01-01T00:00:00Z",9000,9000,9000,9000,1,1,scope)
 news=ManifestEvidenceItem("evidence-news","primary_curated_news","root-news","2026-01-01T00:00:00Z","2028-01-01T00:00:00Z",9000,9000,9000,9000,1,1,scope)
 items=(base,news); citations=("unknown",) if item["kind"] in {"unknown","duplicate"} else ("evidence-price",)
 result=resolve(items,SpecialistCitationOutput(citations),scope,"2026-02-01T00:00:00Z")
 contract=next(value for value in contracts() if value.role==item["role"]); status=gate(contract,items,result)
 pairs=tuple((10000,9900 if item["kind"]!="underpowered" else 10000) for _ in range(10 if item["kind"]=="underpowered" else 100))
 estimate_value=estimate("primary_curated_news",pairs); decision=candidate(estimate_value,item["kind"]=="rare_risk")
 root=digest({"scenario":identifier,"operator":operator,"request":request_hash,"context":context or {},"registry":registry_hash(),"citation":result.resolution_hash,"status":status.status_hash,"estimate":estimate_value.__dict__})
 graph={"rootHash":root,"registryHash":registry_hash(),"scenario":item,"citation":result,"status":status,"estimate":estimate_value,"candidate":decision,"context":context or {}}
 projection={"scenarioId":identifier,"fixtureHash":digest(item),"registryHash":registry_hash(),"suppliedEvidenceCount":len(result.supplied),"citedEvidenceCount":len(result.cited),"supportingEvidenceCount":len(result.supporting),"invalidCitationCount":len(result.invalid),"role":item["role"],"roleStatus":status.status,"reasons":list(status.reasons),"independentRoots":status.independent_roots,"pairedSample":estimate_value.effective_pairs,"estimateBps":estimate_value.estimate_bps,"lowerBps":estimate_value.lower_bps,"upperBps":estimate_value.upper_bps,"attributionState":estimate_value.state,"candidateDecision":decision.decision,"selectedPrerequisiteStatus":"requires_revalidation","maximumCalls":0,"actualProviderCalls":0,"providerCost":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","researchStatus":"hold","rootHash":root[:12],"invariantVerdict":"pass","_artifacts":graph}
 return projection
