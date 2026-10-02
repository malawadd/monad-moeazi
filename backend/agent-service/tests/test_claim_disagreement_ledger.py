from datetime import datetime,timezone
from moeazi_agent.claim_disagreement_canonical import digest,load,utc_second
from moeazi_agent.claim_disagreement_evaluator import evaluate
from moeazi_agent.claim_disagreement_registry import corpus,registry_hash
def run(number,mode="observe"):
 return evaluate(f"ledger-{number:02d}",mode,datetime(2026,2,1,tzinfo=timezone.utc),"operator",digest({"run":number}),{"contextHash":"a"*64})
def test_closed_corpus_and_canonical_rejections():
 assert len(corpus()["scenarios"])==48 and len(corpus()["mutations"])==96 and len(registry_hash())==64
 try: load('{"x":1,"x":2}')
 except ValueError as exc: assert "duplicate" in str(exc)
 else: raise AssertionError("duplicate JSON key accepted")
 for value in ("2026-01-01T00:00:00", "2026-01-01T00:00:00.1Z"):
  try: utc_second(value)
  except ValueError: pass
  else: raise AssertionError("unsafe time accepted")
def test_both_modes_are_deterministic_and_non_authorizing():
 for number in range(1,49):
  a=run(number); b=run(number)
  assert a["rootHash"]==b["rootHash"] and a["fixtureOnly"] and a["productOutcome"]=="unavailable"
  assert a["externalAttempts"]==a["providerAttempts"]==a["signerAttempts"]==a["walletAttempts"]==a["venueAttempts"]==0
  enforce=run(number,"enforce")
  assert enforce["actualCalls"]<=enforce["maximumCalls"] and enforce["actualTokens"]<=enforce["reservedTokens"]
def test_conditional_route_never_reduces_baseline_or_relaxes_context():
 for number in range(1,49):
  result=run(number)
  assert result["maximumCalls"]>=result["baselineCalls"]
  assert result["selectedPrerequisiteStatus"]=="requires_revalidation"
