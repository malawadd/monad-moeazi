"""Deterministic local case fold; no workflow, clock worker, or side effect."""
from .customer_contestation_case_contracts import CaseLifecycleEvent
_NEXT={"submitted":"authenticated","authenticated":"triaged","triaged":"investigating","investigating":"finding_issued","finding_issued":"response_delivered","response_delivered":"appeal_pending","appeal_pending":"appeal_decided","appeal_decided":"remedy_pending","remedy_pending":"closed"}
def fold(events):
 if not events: raise ValueError("LIFECYCLE_INVALID")
 state="submitted"; predecessor=None; time=None
 for expected,event in enumerate(events,1):
  if event.sequence!=expected or event.from_state!=state or _NEXT.get(state)!=event.to_state or event.predecessor_hash!=predecessor or (time and event.observed_at<=time): raise ValueError("LIFECYCLE_INVALID")
  state,predecessor,time=event.to_state,event.event_hash,event.observed_at
 return state,predecessor
