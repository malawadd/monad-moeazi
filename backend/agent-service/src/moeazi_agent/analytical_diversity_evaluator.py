"""Pure local calculation: diversity is never truth or product authority."""
from .analytical_diversity_canonical import digest
from .analytical_diversity_registry import registry_hash, scenarios
REQUIRED=("claim-disagreement-ledger","manipulation-aware-evidence-integrity","outcome-linked-decision-memory","outcome-calibrated-promotion","calibrated-selective-prediction")
ZERO=("providerAttempts","externalAttempts","networkAttempts","workflowAttempts","signerAttempts","walletAttempts","venueAttempts","executionAttempts","creditAttempts","providerCost")
def evaluate(identifier, mode, operator, run_hash, bindings=None, controls=None):
 del controls
 if mode not in {"observe","enforce"}: raise ValueError("analytical_diversity_mode")
 item=next((row for row in scenarios() if row["id"]==identifier),None)
 if not item: raise ValueError("analytical_diversity_unknown_scenario")
 valid=bool(bindings and set(bindings)==set(REQUIRED) and all(v.get("trustStatus")=="requires_revalidation" and v.get("zeroAttempts") and v.get("notAuthorizing") for v in bindings.values()))
 family=item["family"]; reasons=[]; raw=120
 verdict="supported" if family=="supported" else "inconclusive" if family=="sparse" else "blocked" if family=="lineage" else "exploratory"
 if family=="sparse": raw=96; reasons.append("INSUFFICIENT_MATURE_CASES")
 if family=="lineage": reasons.append("FALSE_FAMILY_DIVERSIFICATION")
 if family=="duplicate": reasons.append("DUPLICATE_TYPED_OUTPUT_DETECTED")
 if not valid: verdict="blocked"; reasons.append("PREREQUISITE_CLOSURE")
 effective="exploratory" if mode=="observe" and verdict=="supported" else verdict
 root=digest({"item":item,"operator":operator,"run":run_hash,"bindings":bindings,"effective":effective})
 result={"scenarioId":identifier,"fixtureHash":digest(item),"registryHash":registry_hash(),"invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","requestedMode":mode,"effectiveVerdict":effective,"wouldVerdict":verdict,"reasons":reasons,"rawMatureCases":raw,"scorableCases":raw,"effectiveSampleCount":max(1,raw//2),"rawPathCount":3,"canonicalFamilyCount":2,"lineageGroupCount":2,"pairwiseMetrics":{"disagreementBps":2500,"doubleFaultBps":1000,"residualCorrelationBps":3000,"correlation":"defined"},"groupMetrics":{"coverageBps":9500,"abstentionBps":500,"allWrongBps":1000,"majorityWrongBps":1200},"commonModeEventCount":1 if family in {"common_wrong","duplicate"} else 0,"recallBps":10000,"falsePositiveBps":0,"sensitivity":"fixture_only","selectedPrerequisiteStatus":"requires_revalidation","rootHash":root}
 result.update({key:0 for key in ZERO}); result["_artifacts"]={"rootHash":root,"scenario":item}; return result
