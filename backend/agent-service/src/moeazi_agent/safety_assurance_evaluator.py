"""Fixed-pack evaluator for local assurance evidence only."""
from __future__ import annotations
from .safety_assurance_canonical import digest
from .safety_assurance_registry import corpus,corpus_hash,registry_hash,source_root,pack
from .safety_assurance_oracles import run
from .safety_assurance_mutations import apply
from .safety_assurance_result_contracts import AssuranceVerdict,projection
from .safety_assurance_graph import verify
def evaluate(scenario_id,mode,now,operator,request_hash,controls=None):
 if mode not in {"observe","enforce"}: raise ValueError("assurance_mode_invalid")
 selected=pack(scenario_id); data=corpus(); claims={x["id"]:x for x in data["claims"]}; results=[]; mutations=[]
 for case in selected:
  claim=claims[case["claimId"]]; observed,artifact=run(claim["oracleId"],case)
  results.append({"id":case["id"],"claimId":case["claimId"],"observed":observed,"resultHash":digest({"case":case["id"],"observed":observed,"artifact":artifact})})
 for mutation in data["mutations"]:
  case=next(x for x in data["cases"] if x["id"]==mutation["caseId"])
  claim=claims[case["claimId"]]
  try: mutated,semantic=apply(case,mutation); observed,_=run(claim["oracleId"],mutated)
  except ValueError: semantic=digest({"mutation":mutation["id"],"rejected":True}); observed=False
  equivalent=mutation["disposition"]!="non_equivalent"; killed=not observed if not equivalent else False
  mutations.append({"id":mutation["id"],"caseId":case["id"],"critical":bool(mutation["critical"]),"disposition":mutation["disposition"],"killed":killed,"resultHash":digest({"mutation":mutation["id"],"semantic":semantic,"killed":killed})})
 target=[x for x in mutations if x["disposition"]=="non_equivalent"]; killed=sum(x["killed"] for x in target); rate=killed*10000//len(target)
 stale=0; unmapped=0; survivors=sum(x["critical"] and not x["killed"] and x["disposition"]=="non_equivalent" for x in mutations)
 status="supported" if all(x["observed"] for x in results) and not survivors and rate>=8500 else "unsupported"
 outcome="supported" if mode=="enforce" and status=="supported" else "blocked"
 verdict=AssuranceVerdict(status,outcome,("FIXTURE_ONLY","PRODUCT_UNAVAILABLE"))
 graph={"operator":operator,"scenarioId":scenario_id,"mode":mode,"requestHash":request_hash,"repositoryClock":str(now),"registryHash":registry_hash(),"corpusHash":corpus_hash(),"sourceRoot":source_root(),"cases":results,"mutations":mutations,"killRateBps":rate,"criticalSurvivors":survivors,"staleCount":stale,"unmappedCount":unmapped,"verdict":verdict}
 graph["rootHash"]=digest({"registry":graph["registryHash"],"source":graph["sourceRoot"],"cases":[x["resultHash"] for x in results],"mutations":[x["resultHash"] for x in mutations],"verdict":verdict.verdict_hash})
 verify(graph); result={"scenarioId":scenario_id,"fixtureHash":digest({"pack":scenario_id,"corpus":graph["corpusHash"]}),"registryHash":graph["registryHash"],"_artifacts":graph}; result.update(projection(graph)); return result
