"""Result records deliberately exclude authority, credentials and raw fixtures."""
from __future__ import annotations
from dataclasses import dataclass,field
from .safety_assurance_canonical import digest
@dataclass(frozen=True)
class Artifact:
 id:str; payload:dict; artifact_hash:str=field(init=False)
 def __post_init__(self): object.__setattr__(self,"artifact_hash",digest({"id":self.id,"payload":self.payload}))
@dataclass(frozen=True)
class AssuranceVerdict:
 status:str; qualification_outcome:str; reasons:tuple[str,...]; verdict_hash:str=field(init=False)
 def __post_init__(self):
  if self.status not in {"supported","unsupported","incomplete","stale"}: raise ValueError("assurance_verdict_invalid")
  object.__setattr__(self,"verdict_hash",digest({"status":self.status,"qualification":self.qualification_outcome,"reasons":self.reasons}))
def projection(graph):
 return {"baseline":"synthetic_local","candidate":"system-safety-assurance-corpus","status":graph["verdict"].status,"qualificationOutcome":graph["verdict"].qualification_outcome,"caseCount":len(graph["cases"]),"mutationCount":len(graph["mutations"]),"killedMutationCount":sum(x["killed"] for x in graph["mutations"]),"killRateBps":graph["killRateBps"],"criticalSurvivorCount":graph["criticalSurvivors"],"staleCount":graph["staleCount"],"unmappedCount":graph["unmappedCount"],"reasons":list(graph["verdict"].reasons),"rootHash":graph["rootHash"][:12],"fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","modelOracleUsed":False,"externalAttempts":0,"providerCost":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"invariantVerdict":"pass" if graph["verdict"].status=="supported" else "blocked"}
