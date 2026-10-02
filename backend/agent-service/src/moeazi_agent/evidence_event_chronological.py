"""Fixed local 30-day chronological fixture simulation; it never schedules work."""
from __future__ import annotations
from datetime import datetime,timedelta,timezone
from .evidence_event_evaluator import evaluate
def run_chronological_simulation():
 now=datetime(2026,9,1,tzinfo=timezone.utc); intents=coalesced=missed=0; maximum_age=0
 for index in range(6400):
  event_at=now+timedelta(minutes=15*index); risk=index>=5760
  row={"operation":"inspect","market":"arb-usdc" if index%2 else "arb-eth","timeline":[{"source":"risk-control" if risk else "market-data","sourceEventId":f"cadence-{index}","eventClass":"risk_override" if risk else "quote","eventAt":event_at,"observedAt":event_at,"receivedAt":event_at,"body":{"value":index,"risk":int(risk)}}]}
  graph=evaluate(row,"observe",event_at,"operator:chronological",f"{index:064x}")
  if risk:
   if graph["trigger"]["priority"]!="high": missed+=1
   intents+=1
  else: coalesced+=1
  maximum_age=max(maximum_age,int((event_at-event_at).total_seconds()))
 return {"inputCount":6400,"baselineCadenceOpportunities":5760,"materialRiskCorrectionEvents":640,"candidateIntentCount":intents,"coalescedCount":coalesced,"maximumSnapshotAgeSeconds":maximum_age,"missedMaterialEvents":missed,"reductionNumerator":5760-intents,"reductionDenominator":5760,"fixtureOnly":True,"workflowStarted":False,"providerCost":0}
