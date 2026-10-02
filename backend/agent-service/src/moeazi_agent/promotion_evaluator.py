"""Integer-only deterministic decision table. Eligible is a review receipt, never activation."""
from __future__ import annotations
from .promotion_canonical import digest
from .promotion_registry import registry_hash, scenarios
ORDER=("eligible","hold","reject","demote","block","kill")
def _winner(*states): return max(states, key=ORDER.index)
def evaluate(identifier: str, mode: str, operator: str, run_hash: str, bindings: dict | None = None):
    if mode not in {"observe","enforce"}: raise ValueError("promotion_mode")
    item=next((x for x in scenarios() if x["id"]==identifier),None)
    if not item: raise ValueError("promotion_unknown_scenario")
    kind=item["kind"]; reasons=[]; state="eligible"; raw=32; effective=32
    if not bindings or set(bindings)!={"calibrated-shadow-execution-tca","outcome-linked-decision-memory"}: state="block"; reasons.append("PREREQUISITE_SELECTION")
    elif any(v.get("trustStatus")!="requires_revalidation" or not v.get("zeroAttempts") or not v.get("notAuthorizing") for v in bindings.values()): state="block"; reasons.append("PREREQUISITE_CLOSURE")
    if kind in {"drift","rollback-block"}: state=_winner(state,"block"); reasons.append("CONFIGURATION_OR_ROLLBACK_DRIFT")
    if kind in {"boundary","kill"}: state="kill"; reasons.append("BOUNDARY_BREACH")
    if kind in {"underpowered","uncertain","corrected"}: state=_winner(state,"hold"); reasons.append("INSUFFICIENT_OR_UNCERTAIN_EVIDENCE"); effective=8
    if kind in {"reject","missing-cost"}: state=_winner(state,"reject"); reasons.append("PREACTIVATION_HARD_GATE")
    if kind=="demote": state=_winner(state,"demote"); reasons.append("TWO_POWERED_WINDOWS_OUTSIDE_MARGIN")
    if kind=="noninferior": reasons.append("NONINFERIORITY_PROVEN")
    observed="hold" if mode=="observe" else state
    action="inspect" if mode=="observe" else "request_explicit_review" if observed=="eligible" else "inspect"
    metrics={"calibration":{"estimateBps":120,"lowerBps":80,"upperBps":160,"gate":"pass" if kind in {"eligible","noninferior"} else "hold"},"outcome":{"estimateBps":75,"lowerBps":20,"upperBps":110,"gate":"pass" if kind=="eligible" else "hold"}}
    root=digest({"scenario":item,"operator":operator,"run":run_hash,"bindings":bindings,"state":observed,"reasons":reasons,"metrics":metrics})
    return {"scenarioId":identifier,"fixtureHash":digest(item),"registryHash":registry_hash(),"invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","automaticActivationAvailable":False,"automaticRollbackAvailable":False,"decision":observed,"precedenceReasons":reasons,"allowedNextAction":action,"candidateVersion":1,"championVersion":1,"candidateHash":digest({"candidate":identifier}),"championHash":digest({"champion":identifier}),"planHash":digest({"plan":identifier}),"rollbackHash":digest({"rollback":identifier}),"cutoffAt":"2026-01-01T03:00:00Z","rawPairs":raw,"effectivePairs":effective,"powerBps":9000 if effective==raw else 2500,"metrics":metrics,"trialFamilySize":4,"monitoringWindows":2 if kind=="demote" else 0,"rollbackSimulation":"blocked" if kind=="rollback-block" else "not_required","selectedPrerequisiteStatus":"requires_revalidation","providerAttempts":0,"externalAttempts":0,"networkAttempts":0,"workflowAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"executionAttempts":0,"creditAttempts":0,"providerCost":0,"rootHash":root,"_artifacts":{"rootHash":root,"scenario":item}}
